import pandas as pd
import numpy as np
import random
from datetime import datetime, timedelta

def generate_data():
    random.seed(42)
    np.random.seed(42)
    
    n_rows = 5000
    order_ids = [f"ORD{i:04d}" for i in range(1000, 1000 + n_rows)]
    base_date = datetime(2026, 8, 1)
    
    data = []
    for i in range(n_rows):
        order_id = order_ids[i]
        created_at = (base_date + timedelta(minutes=i*15)).strftime("%Y-%m-%d %H:%M:%S")
        customer_email = f"customer_{i}@example.com"
        quantity = random.randint(1, 5)
        unit_price = float(random.randint(10, 30))
        total = float(quantity * unit_price)
        country = "US"
        currency = "USD"
        phone = f"+1555010{i:04d}"
        
        data.append({
            "order_id": order_id,
            "created_at": created_at,
            "customer_email": customer_email,
            "quantity": quantity,
            "unit_price": unit_price,
            "total": total,
            "country": country,
            "currency": currency,
            "phone": phone
        })
        
    # Inject specific anomalies matching Worked Example in §17
    # 1. Row index 1003: Missing customer_email
    data[1003]["customer_email"] = ""
    
    # 2. Row index 1004: Negative quantity, and a duplicated row
    data[1004]["quantity"] = -1
    data[1004]["unit_price"] = 15.0
    data[1004]["total"] = -15.0
    
    # Inject duplicate of Row 1004 at index 1005 (which shifts elements)
    dup_row = data[1004].copy()
    data.insert(1005, dup_row)
    
    # 3. Legitimate high-value outlier at index 1006 (Total = $999)
    # Quantity = 1, unit_price = 999.00, total = 999.00 (passes qty * price = total)
    data[1006]["quantity"] = 1
    data[1006]["unit_price"] = 999.0
    data[1006]["total"] = 999.0
    data[1006]["customer_email"] = "vip_buyer@gmail.com"
    data[1006]["order_id"] = "ORD2005"
    
    # 4. Decimal entry error at index 1009: Total = $180 vs expected $18
    # Quantity = 1, unit_price = 18.00, total = 180.00 (fails qty * price = total)
    # Also let's set an inconsistent date format for this row to test normalization
    data[1009]["quantity"] = 1
    data[1009]["unit_price"] = 18.0
    data[1009]["total"] = 180.0
    data[1009]["created_at"] = "08/18/2026"
    
    # Trim to exactly 5000 rows (including duplicate row)
    data = data[:5000]
    
    df_corrupted = pd.DataFrame(data)
    df_corrupted.to_csv("sample_data/shopify_orders_corrupted.csv", index=False)
    
    # Clean baseline (no rules violated, no anomalies)
    clean_data = []
    for i in range(n_rows):
        order_id = order_ids[i]
        created_at = (base_date + timedelta(minutes=i*15)).strftime("%Y-%m-%d %H:%M:%S")
        customer_email = f"customer_{i}@example.com"
        quantity = random.randint(1, 5)
        unit_price = float(random.randint(10, 30))
        total = float(quantity * unit_price)
        country = "US"
        currency = "USD"
        phone = f"+1555010{i:04d}"
        
        clean_data.append({
            "order_id": order_id,
            "created_at": created_at,
            "customer_email": customer_email,
            "quantity": quantity,
            "unit_price": unit_price,
            "total": total,
            "country": country,
            "currency": currency,
            "phone": phone
        })
    df_clean = pd.DataFrame(clean_data)
    df_clean.to_csv("sample_data/shopify_orders_clean.csv", index=False)
    print("Successfully generated shopify_orders_clean.csv and shopify_orders_corrupted.csv!")

if __name__ == "__main__":
    generate_data()
