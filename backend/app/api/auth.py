import os
import uuid
import datetime
import secrets
import hashlib
import smtplib
from email.mime.text import MIMEText
from datetime import timedelta
# pyrefly: ignore [missing-import]
import jwt
import httpx
import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Response, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from typing import Optional
from app.core.config import settings
from app.core.database import get_db
from app.models.models import User, PasswordResetToken
from app.schemas.schemas import SignupRequest, LoginRequest, ForgotPasswordRequest, ResetPasswordRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))

def send_reset_email(to_email: str, raw_token: str):
    reset_link = f"{settings.RESET_LINK_BASE_URL}?token={raw_token}"
    subject = "Reset your DataSetIQ password"
    body = (
        "You requested a password reset for your DataSetIQ account.\n"
        "Please use the following link to reset your password:\n\n"
        f"{reset_link}\n\n"
        "This link expires in 30 minutes. If you didn't request this, you can safely ignore this email."
    )
    
    # Print to console/logs for verification/testing
    print("==================================================")
    print(f"PASSWORD RESET EMAIL SENT TO: {to_email}")
    print(f"SUBJECT: {subject}")
    print(f"BODY:\n{body}")
    print("==================================================")
    
    # Also log it to a text file for easy automated testing retrieval
    try:
        log_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        log_path = os.path.join(log_dir, "reset_emails.log")
        with open(log_path, "a") as f:
            f.write(f"TIMESTAMP: {datetime.datetime.utcnow().isoformat()}\n")
            f.write(f"TO: {to_email}\n")
            f.write(f"LINK: {reset_link}\n")
            f.write("--------------------------------------------------\n")
    except Exception as log_err:
        print(f"Failed to log reset email to file: {log_err}")
    
    if not settings.SMTP_USER or "placeholder" in settings.SMTP_USER:
        print("SMTP credentials not configured or set to placeholder. Skipping real email send.")
        return
        
    try:
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"] = settings.SMTP_USER
        msg["To"] = to_email
        
        # Strip spaces from App Password (Gmail shows them grouped in 4s for readability)
        smtp_password = settings.SMTP_PASSWORD.replace(" ", "")
        
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(settings.SMTP_USER, smtp_password)
            server.send_message(msg)
        print("SMTP real email sent successfully!")
    except Exception as e:
        print(f"Failed to send email via SMTP: {e}")

def create_jwt_token(user_id: str) -> str:
    payload = {
        "user_id": user_id,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=7),
        "iat": datetime.datetime.utcnow()
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")

@router.get("/google/login")
def google_login(response: Response):
    state = str(uuid.uuid4().hex)
    
    # If client ID is mock, bypass to local redirect callback directly
    if settings.GOOGLE_CLIENT_ID.startswith("mock_"):
        BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
        callback_url = f"{BACKEND_URL}/api/auth/callback"
        
        res = RedirectResponse(callback_url)
        res.set_cookie(
            key="oauth_state",
            value=state,
            httponly=True,
            samesite="lax",
            max_age=300
        )
        return res

    # Real Google OAuth redirect URL
    google_url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={settings.GOOGLE_CLIENT_ID}"
        f"&redirect_uri={settings.GOOGLE_REDIRECT_URI}"
        "&response_type=code"
        "&scope=openid email profile"
        f"&state={state}"
    )
    res = RedirectResponse(google_url)
    res.set_cookie(
        key="oauth_state",
        value=state,
        httponly=True,
        samesite="lax",
        max_age=300
    )
    return res

@router.get("/google/callback")
def google_callback(
    request: Request,
    response: Response,
    code: str,
    state: str,
    db: Session = Depends(get_db)
):
    # Verify state
    cookie_state = request.cookies.get("oauth_state")
    if not cookie_state or cookie_state != state:
        raise HTTPException(status_code=400, detail="State parameter mismatch. CSRF validation failed.")
    
    email = None
    name = None
    sub = None

    if settings.GOOGLE_CLIENT_ID.startswith("mock_") and code.startswith("mock_code"):
        # Simulated profile
        email = "mockuser@gmail.com"
        name = "Mock Google User"
        sub = "google-sub-mock-12345"
    else:
        # Real Google exchange & verify
        try:
            # Token Exchange
            token_url = "https://oauth2.googleapis.com/token"
            data = {
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            }
            res = httpx.post(token_url, data=data)
            if res.status_code != 200:
                raise HTTPException(status_code=400, detail=f"Failed to exchange auth code: {res.text}")
            
            tokens = res.json()
            id_token_str = tokens.get("id_token")
            if not id_token_str:
                raise HTTPException(status_code=400, detail="Response from Google did not include ID token")
            
            # Verify ID Token
            id_info = id_token.verify_oauth2_token(
                id_token_str,
                google_requests.Request(),
                audience=settings.GOOGLE_CLIENT_ID
            )
            
            email = id_info.get("email")
            name = id_info.get("name")
            sub = id_info.get("sub")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Google authentication failed: {str(e)}")

    if not sub or not email:
        raise HTTPException(status_code=400, detail="Invalid user profile returned from Google")

    # Look up user or create
    user = db.query(User).filter(User.google_sub == sub).first()
    if not user:
        user = User(
            google_sub=sub,
            email=email,
            name=name or email.split("@")[0]
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    # Issue session token
    session_token = create_jwt_token(user.id)
    
    # Redirect to Frontend
    frontend_url = settings.FRONTEND_URL or "http://localhost:5173"
    redirect_response = RedirectResponse(frontend_url)
    
    # Set cookies: session_token (expires in 7 days), and delete oauth_state
    redirect_response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        samesite="lax",
        max_age=7 * 24 * 3600
    )
    redirect_response.delete_cookie("oauth_state")
    return redirect_response

@router.post("/logout")
def logout(response: Response):
    res = Response(content="{\"message\": \"Logged out successfully\"}", media_type="application/json")
    res.delete_cookie("session_token")
    return res

@router.get("/me")
def get_me(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get("session_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
        user_id = payload.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return {"id": user.id, "name": user.name, "email": user.email}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

def get_current_user_optional(request: Request, db: Session = Depends(get_db)) -> Optional[User]:
    token = request.cookies.get("session_token")
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
        user_id = payload.get("user_id")
        if not user_id:
            return None
        return db.query(User).filter(User.id == user_id).first()
    except jwt.PyJWTError:
        return None

def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = get_current_user_optional(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user

@router.post("/signup")
def signup(payload: SignupRequest, response: Response, db: Session = Depends(get_db)):
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long.")
    
    existing_user = db.query(User).filter(User.email == payload.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="An account with this email already exists.")
    
    hashed = hash_password(payload.password)
    user = User(
        email=payload.email,
        name=payload.name,
        auth_provider="password",
        password_hash=hashed,
        google_sub=None
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    session_token = create_jwt_token(user.id)
    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        samesite="lax",
        max_age=7 * 24 * 3600
    )
    return {"message": "Signup successful", "user": {"id": user.id, "email": user.email, "name": user.name}}

@router.post("/login")
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid email or password.")
    
    if user.auth_provider != "password":
        raise HTTPException(status_code=400, detail="This account is registered via Google Sign-In. Please sign in with Google.")
        
    if not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Invalid email or password.")
        
    session_token = create_jwt_token(user.id)
    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        samesite="lax",
        max_age=7 * 24 * 3600
    )
    return {"message": "Login successful", "user": {"id": user.id, "email": user.email, "name": user.name}}

@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    generic_msg = {"message": "If an account exists for this email, a reset link has been sent."}
    
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or user.auth_provider != "password":
        return generic_msg
        
    one_hour_ago = datetime.datetime.utcnow() - datetime.timedelta(hours=1)
    recent_tokens_count = db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.created_at >= one_hour_ago
    ).count()
    
    if recent_tokens_count >= 3:
        raise HTTPException(status_code=429, detail="Too many password reset requests. Please try again later.")
        
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    
    expires_at = datetime.datetime.utcnow() + datetime.timedelta(minutes=30)
    reset_token = PasswordResetToken(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=expires_at,
        used=False
    )
    db.add(reset_token)
    db.commit()
    
    send_reset_email(user.email, raw_token)
    
    return generic_msg

@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    token_hash = hashlib.sha256(payload.token.encode("utf-8")).hexdigest()
    
    reset_token = db.query(PasswordResetToken).filter(
        PasswordResetToken.token_hash == token_hash
    ).first()
    
    if not reset_token or reset_token.used or reset_token.expires_at < datetime.datetime.utcnow():
        raise HTTPException(
            status_code=400,
            detail="This reset link is invalid or has expired. Please request a new one."
        )
        
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long.")
        
    user = db.query(User).filter(User.id == reset_token.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found.")
        
    user.password_hash = hash_password(payload.new_password)
    reset_token.used = True
    
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used == False
    ).update({PasswordResetToken.used: True})
    
    db.commit()
    
    return {"message": "Password updated successfully. Please sign in with your new password."}
