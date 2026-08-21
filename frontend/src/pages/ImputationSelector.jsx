import React, { useState } from "react";

export default function ImputationSelector({ column, previews, onApplySingle, onApplyBatch }) {
  const [customValue, setCustomValue] = useState("");
  const [selectedOption, setSelectedOption] = useState("");

  const isNumeric = previews && previews.mean !== undefined && previews.mean !== null;
  const modeVal = previews?.mode !== undefined && previews?.mode !== null ? previews.mode : "—";
  const meanVal = previews?.mean !== undefined && previews?.mean !== null ? previews.mean : "—";
  const medianVal = previews?.median !== undefined && previews?.median !== null ? previews.median : "—";

  const options = [
    ...(isNumeric ? [
      { id: "impute_mean", name: "Column Mean", val: meanVal, desc: `Replace with the column mean value (${meanVal})` },
      { id: "impute_median", name: "Column Median", val: medianVal, desc: `Replace with the column median value (${medianVal})` }
    ] : []),
    { id: "impute_mode", name: "Column Mode", val: modeVal, desc: `Replace with the most frequent value (${modeVal})` },
    { id: "leave_blank", name: "Leave Blank", val: "—", desc: "Keep cell empty and skip validation" },
    { id: "custom", name: "Custom Value", val: null, desc: "Enter a specific manual value" }
  ];

  return (
    <div className="bg-slate-950/50 border border-slate-900 rounded-xl p-4 space-y-4 font-mono text-xs text-slate-400">
      <div className="text-[11px] text-amber-500 font-bold uppercase tracking-wider select-none flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></div>
        <span>Imputation & Cleaning Options</span>
      </div>
      
      <div className="space-y-2.5">
        {options.map((opt) => (
          <div 
            key={opt.id} 
            className={`border rounded-lg p-3 transition-all ${
              selectedOption === opt.id 
                ? "bg-blue-500/5 border-blue-500/30 text-slate-200" 
                : "bg-slate-900/30 border-slate-850 hover:bg-slate-900/50 hover:border-slate-800"
            }`}
          >
            <div className="flex items-center justify-between cursor-pointer" onClick={() => setSelectedOption(opt.id)}>
              <div className="flex items-center gap-2">
                <input 
                  type="radio" 
                  name="impute_opt" 
                  checked={selectedOption === opt.id}
                  onChange={() => setSelectedOption(opt.id)}
                  className="accent-blue-500 cursor-pointer"
                />
                <span className="font-semibold text-slate-100">{opt.name}</span>
              </div>
              {opt.val !== null && (
                <span className="px-2 py-0.5 bg-slate-950 border border-slate-800 rounded text-slate-400 font-bold text-[10px]">
                  {String(opt.val)}
                </span>
              )}
            </div>
            
            {selectedOption === opt.id && (
              <div className="mt-3 pt-3 border-t border-slate-850 space-y-3">
                <p className="text-[11px] text-slate-450 font-sans leading-relaxed">
                  {opt.desc}
                </p>
                
                {opt.id === "custom" && (
                  <input
                    type="text"
                    value={customValue}
                    onChange={(e) => setCustomValue(e.target.value)}
                    placeholder="Enter custom value..."
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-blue-550 font-mono"
                    autoFocus
                  />
                )}
                
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => {
                      if (opt.id === "custom") {
                        onApplySingle("MANUAL_EDIT", customValue);
                      } else {
                        onApplySingle(opt.id);
                      }
                    }}
                    className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all text-slate-950 font-extrabold rounded text-[10px] cursor-pointer"
                  >
                    Apply to this cell
                  </button>
                  <button
                    onClick={() => {
                      if (opt.id === "custom") {
                        onApplyBatch("MANUAL_EDIT", customValue);
                      } else {
                        onApplyBatch(opt.id);
                      }
                    }}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 transition-all text-slate-350 hover:text-slate-200 font-semibold rounded text-[10px] cursor-pointer border border-slate-700"
                  >
                    Apply to all blank in {column}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
