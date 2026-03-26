import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";
import {
  fetchAuditions, upsertAudition, deleteAuditionDB,
  fetchPracticeLog, insertPractice, deletePracticeDB,
  fetchReadiness, upsertReadiness,
  fetchSettings, upsertSettings,
} from "./supabaseData";

const SK = "aud-tracker-v4";
const STATUSES = ["Preparing","Applied","Scheduled","Auditioned","Advanced","Won","Didn't Advance","Withdrew"];
const STATUS_COLORS = {
  Preparing:"bg-yellow-100 text-yellow-800",
  Applied:"bg-blue-100 text-blue-800",
  Scheduled:"bg-indigo-100 text-indigo-800",
  Auditioned:"bg-purple-100 text-purple-800",
  Advanced:"bg-emerald-100 text-emerald-800",
  Won:"bg-green-200 text-green-900",
  "Didn't Advance":"bg-gray-100 text-gray-600",
  Withdrew:"bg-red-100 text-red-700"
};
const READINESS = ["Not Started","Rough","In Progress","Nearly Ready","Performance Ready"];
const READINESS_COLORS = {
  "Not Started":"bg-red-100 text-red-700",
  "Rough":"bg-orange-100 text-orange-700",
  "In Progress":"bg-yellow-100 text-yellow-800",
  "Nearly Ready":"bg-blue-100 text-blue-700",
  "Performance Ready":"bg-green-100 text-green-700"
};
const RVAL = {"Not Started":0,"Rough":1,"In Progress":2,"Nearly Ready":3,"Performance Ready":4};

const DEFAULT_SETTINGS = {
  excerptTimerMins: 20,
  sessionTimerMins: 120,
  runThroughMilestones: [
    {daysOut:21, label:"Play excerpts for a friend/colleague", type:"informal"},
    {daysOut:14, label:"Full run-through for someone", type:"runthrough"},
    {daysOut:7, label:"Mock audition (simulate real conditions)", type:"mock"},
    {daysOut:3, label:"Final dress run-through", type:"dress"},
  ],
};

var API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";

function gid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}

function daysUntil(d) {
  if (!d) return Infinity;
  var target = new Date(d + "T12:00:00");
  var now = new Date();
  now.setHours(0,0,0,0);
  target.setHours(0,0,0,0);
  return Math.ceil((target - now) / 864e5);
}

function fmtDate(d) {
  if (!d) return "";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric"});
}

function localDateStr(dt) {
  var d = dt || new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function minsToHM(m) {
  var h = Math.floor(m / 60);
  var r = m % 60;
  if (!h) return r + "m";
  if (!r) return h + "h";
  return h + "h " + r + "m";
}

function excLabel(e) {
  if (!e.structured) return e.freeText;
  var s = e.piece;
  if (e.movement) s += " — " + e.movement;
  if (e.measures) s += " (mm. " + e.measures + ")";
  return s;
}

function normExcerpt(e) {
  return (e.structured ? e.piece + " " + e.movement : e.freeText).toLowerCase().replace(/\s+/g, " ").trim();
}

function autoAbbrev(name) {
  if (!name) return "";
  var words = name.trim().split(/\s+/);
  var skip = ["the","of","for","and","in","at"];
  var letters = words.filter(function(w) { return skip.indexOf(w.toLowerCase()) < 0; }).map(function(w) { return w[0].toUpperCase(); });
  return letters.join("");
}

function getShortName(a) {
  return a.shortName || autoAbbrev(a.orchestra);
}

function loadData() {
  return null;
}

function saveData(data) {
  // no-op: writes now go through Supabase
}

function makeDefault() {
  return {
    auditions: [],
    practiceLog: [],
    readiness: {},
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  };
}

async function extractPDF(file) {
  var b64 = await new Promise(function(res, rej) {
    var r = new FileReader();
    r.onload = function() { res(r.result.split(",")[1]); };
    r.onerror = function() { rej(new Error("fail")); };
    r.readAsDataURL(file);
  });
  var resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{role: "user", content: [
        {type: "document", source: {type: "base64", media_type: "application/pdf", data: b64}},
        {type: "text", text: 'Extract all audition repertoire/excerpts from this PDF. Return ONLY a JSON array, no markdown, no backticks. Each object: "piece" (composer and work), "movement" (or ""), "measures" (or "").'}
      ]}]
    })
  });
  var data = await resp.json();
  var text = (data.content || []).map(function(b){return b.text || ""}).join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

function Badge(props) {
  return (
    <span className={"text-xs font-medium px-2 py-0.5 rounded-full " + (STATUS_COLORS[props.status] || "bg-gray-100 text-gray-700")}>
      {props.status}
    </span>
  );
}

function RBadge(props) {
  return (
    <span className={"text-xs font-medium px-2 py-0.5 rounded-full " + (READINESS_COLORS[props.level] || "bg-gray-100 text-gray-700")}>
      {props.level}
    </span>
  );
}

function TabBtn(props) {
  return (
    <button
      onClick={props.onClick}
      className={"px-3 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap relative " + (props.active ? "bg-white text-indigo-700 border-b-2 border-indigo-600" : "text-gray-500 hover:text-gray-700")}
    >
      {props.label}
      {props.alert && <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />}
    </button>
  );
}

function Inp(props) {
  var label = props.label;
  var rest = Object.assign({}, props);
  delete rest.label;
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium text-gray-600">{label}</label>}
      <input className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" {...rest} />
    </div>
  );
}

function Sel(props) {
  var label = props.label;
  var options = props.options;
  var rest = Object.assign({}, props);
  delete rest.label;
  delete rest.options;
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium text-gray-600">{label}</label>}
      <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" {...rest}>
        {options.map(function(o) { return <option key={o} value={o}>{o}</option>; })}
      </select>
    </div>
  );
}

function Btn(props) {
  var children = props.children;
  var variant = props.variant || "primary";
  var className = props.className || "";
  var rest = Object.assign({}, props);
  delete rest.children;
  delete rest.variant;
  delete rest.className;
  var styles = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    secondary: "bg-gray-100 text-gray-700 hover:bg-gray-200",
    danger: "bg-red-50 text-red-600 hover:bg-red-100",
    ghost: "text-gray-500 hover:text-gray-700"
  };
  return (
    <button className={"px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-40 " + styles[variant] + " " + className} {...rest}>
      {children}
    </button>
  );
}

function BirdPopup(props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30" onClick={props.onClose}>
      <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-xs text-center relative" onClick={function(e){e.stopPropagation()}}>
        <div className="text-6xl mb-2">🐦</div>
        <div className="relative bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-4">
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-indigo-50 border-l border-t border-indigo-200 rotate-45" />
          <p className="text-sm font-medium text-indigo-800 relative z-10">{props.message}</p>
        </div>
        <Btn onClick={props.onClose}>Got it!</Btn>
      </div>
    </div>
  );
}

function TimerWidget(props) {
  var defaultMins = props.defaultMins;
  var mode = props.mode;
  var onComplete = props.onComplete;
  var [inputMins, setInputMins] = useState(defaultMins);
  var [secsLeft, setSecsLeft] = useState(null);
  var [running, setRunning] = useState(false);
  var intervalRef = useRef(null);

  useEffect(function() { setInputMins(defaultMins); }, [defaultMins]);

  function start() {
    var total = Math.max(1, parseInt(inputMins) || 1) * 60;
    setSecsLeft(total);
    setRunning(true);
  }

  function stop() {
    setRunning(false);
    setSecsLeft(null);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }

  function togglePause() {
    setRunning(function(r) { return !r; });
  }

  useEffect(function() {
    if (running && secsLeft !== null) {
      intervalRef.current = setInterval(function() {
        setSecsLeft(function(s) {
          if (s <= 1) {
            clearInterval(intervalRef.current);
            setRunning(false);
            onComplete();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
      return function() { clearInterval(intervalRef.current); };
    }
  }, [running]);

  var mm = secsLeft !== null ? String(Math.floor(secsLeft / 60)).padStart(2, "0") : "--";
  var ss = secsLeft !== null ? String(secsLeft % 60).padStart(2, "0") : "--";
  var pct = secsLeft !== null && inputMins ? Math.max(0, (1 - secsLeft / (inputMins * 60)) * 100) : 0;
  var barColor = pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#6366f1";

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">
          {mode === "excerpt" ? "⏱ Excerpt Timer" : "⏱ Session Timer"}
        </span>
        {secsLeft === null && (
          <div className="flex items-center gap-2">
            <input type="number" className="border border-gray-300 rounded px-2 py-1 text-sm w-16 text-center" value={inputMins} onChange={function(e){setInputMins(e.target.value)}} min={1} />
            <span className="text-xs text-gray-500">min</span>
          </div>
        )}
      </div>
      {secsLeft !== null && (
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div className="h-2 rounded-full transition-all duration-1000" style={{width: pct + "%", backgroundColor: barColor}} />
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className={"text-3xl font-mono font-bold " + (secsLeft !== null && secsLeft < 60 ? "text-red-600 animate-pulse" : "text-gray-800")}>
          {mm}:{ss}
        </span>
        <div className="flex gap-2">
          {secsLeft === null ? (
            <Btn onClick={start}>Start</Btn>
          ) : (
            <>
              <Btn variant="secondary" onClick={togglePause}>{running ? "Pause" : "Resume"}</Btn>
              <Btn variant="danger" onClick={stop}>Reset</Btn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ExcerptInput(props) {
  var excerpts = props.excerpts;
  var onChange = props.onChange;
  var [mode, setMode] = useState("free");
  var [draft, setDraft] = useState({freeText:"", piece:"", movement:"", measures:""});
  var [uploading, setUploading] = useState(false);
  var [err, setErr] = useState("");

  function add() {
    if (mode === "free" && !draft.freeText.trim()) return;
    if (mode === "structured" && !draft.piece.trim()) return;
    var entry;
    if (mode === "free") {
      entry = {structured: false, freeText: draft.freeText.trim(), id: gid()};
    } else {
      entry = {structured: true, piece: draft.piece.trim(), movement: draft.movement.trim(), measures: draft.measures.trim(), id: gid()};
    }
    onChange([...excerpts, entry]);
    setDraft({freeText:"", piece:"", movement:"", measures:""});
  }

  async function handlePDF(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!API_KEY) {
      setErr("No API key configured. Add VITE_ANTHROPIC_API_KEY to your environment.");
      return;
    }
    setUploading(true);
    setErr("");
    try {
      var items = await extractPDF(file);
      var newItems = items.map(function(it) {
        return {id: gid(), structured: true, piece: it.piece || "", movement: it.movement || "", measures: it.measures || ""};
      });
      onChange([...excerpts, ...newItems]);
    } catch(ex) {
      console.error(ex);
      setErr("Could not extract from PDF. Try adding manually.");
    }
    setUploading(false);
    e.target.value = "";
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-xs text-gray-500">Input:</span>
        <button onClick={function(){setMode("free")}} className={"text-xs px-2 py-1 rounded " + (mode === "free" ? "bg-indigo-100 text-indigo-700" : "text-gray-500")}>Free text</button>
        <button onClick={function(){setMode("structured")}} className={"text-xs px-2 py-1 rounded " + (mode === "structured" ? "bg-indigo-100 text-indigo-700" : "text-gray-500")}>Structured</button>
        <span className="text-xs text-gray-300">|</span>
        <label className={"text-xs px-3 py-1 rounded cursor-pointer " + (uploading ? "bg-gray-100 text-gray-400" : "bg-violet-100 text-violet-700 hover:bg-violet-200")}>
          {uploading ? "Extracting..." : "Upload PDF"}
          <input type="file" accept=".pdf" className="hidden" onChange={handlePDF} disabled={uploading} />
        </label>
      </div>
      {uploading && (
        <div className="flex items-center gap-2 text-sm text-violet-600">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          Reading PDF...
        </div>
      )}
      {err && <p className="text-xs text-red-500">{err}</p>}
      {mode === "free" ? (
        <div className="flex gap-2">
          <input className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Don Juan opening" value={draft.freeText} onChange={function(e){setDraft({...draft, freeText: e.target.value})}} onKeyDown={function(e){if(e.key==="Enter") add()}} />
          <Btn onClick={add}>Add</Btn>
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap items-end">
          <Inp label="Piece" placeholder="Brahms Symphony No. 1" value={draft.piece} onChange={function(e){setDraft({...draft, piece: e.target.value})}} />
          <Inp label="Movement" placeholder="IV" value={draft.movement} onChange={function(e){setDraft({...draft, movement: e.target.value})}} />
          <Inp label="Measures" placeholder="1-20" value={draft.measures} onChange={function(e){setDraft({...draft, measures: e.target.value})}} />
          <Btn onClick={add}>Add</Btn>
        </div>
      )}
      {excerpts.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">{excerpts.length} excerpt{excerpts.length !== 1 ? "s" : ""}</span>
            {excerpts.length > 3 && <button onClick={function(){onChange([])}} className="text-xs text-red-400 hover:text-red-600">Clear all</button>}
          </div>
          <div className="flex flex-wrap gap-2">
            {excerpts.map(function(e) {
              return (
                <span key={e.id} className="inline-flex items-center gap-1 bg-gray-100 text-sm px-3 py-1 rounded-full">
                  {excLabel(e)}
                  <button onClick={function(){onChange(excerpts.filter(function(x){return x.id !== e.id}))}} className="text-gray-400 hover:text-red-500 ml-1">&times;</button>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AuditionForm(props) {
  var initial = props.initial;
  var onSave = props.onSave;
  var onCancel = props.onCancel;
  var [f, setF] = useState(initial || {id: gid(), orchestra:"", shortName:"", date:"", location:"", status:"Preparing", round:"", notes:"", excerpts:[]});
  var [autoShort, setAutoShort] = useState(!initial || !initial.shortName);

  function s(k, v) {
    setF(function(prev) {
      var next = {...prev, [k]: v};
      if (k === "orchestra" && autoShort) {
        next.shortName = autoAbbrev(v);
      }
      return next;
    });
  }

  function setShort(v) {
    setAutoShort(false);
    setF(function(prev) { return {...prev, shortName: v}; });
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 shadow-sm">
      <h3 className="font-semibold text-gray-800">{initial ? "Edit Audition" : "New Audition"}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Inp label="Orchestra" value={f.orchestra} onChange={function(e){s("orchestra",e.target.value)}} placeholder="Chicago Symphony Orchestra" />
        <Inp label="Short Name" value={f.shortName} onChange={function(e){setShort(e.target.value)}} placeholder="CSO" />
        <Inp label="Date" type="date" value={f.date} onChange={function(e){s("date",e.target.value)}} />
        <Inp label="Location" value={f.location} onChange={function(e){s("location",e.target.value)}} placeholder="Symphony Center" />
        <Inp label="Round" value={f.round} onChange={function(e){s("round",e.target.value)}} placeholder="Prelim / Semi / Final" />
        <Sel label="Status" value={f.status} onChange={function(e){s("status",e.target.value)}} options={STATUSES} />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-1">Notes</label>
        <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" rows={2} value={f.notes} onChange={function(e){s("notes",e.target.value)}} placeholder="Feedback, thoughts..." />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-2">Rep List</label>
        <ExcerptInput excerpts={f.excerpts} onChange={function(ex){s("excerpts",ex)}} />
      </div>
      <div className="flex gap-2 justify-end">
        <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
        <Btn onClick={function(){onSave(f)}} disabled={!f.orchestra.trim()}>Save</Btn>
      </div>
    </div>
  );
}

function RunThroughPanel(props) {
  var auditions = props.auditions;
  var settings = props.settings;
  var onSwitchTab = props.onSwitchTab;
  var active = auditions.filter(function(a) {
    return ["Preparing","Applied","Scheduled"].indexOf(a.status) >= 0 && a.date;
  });
  if (!active.length) return null;

  var milestones = settings.runThroughMilestones || DEFAULT_SETTINGS.runThroughMilestones;
  var upcoming = [];
  active.forEach(function(a) {
    var days = daysUntil(a.date);
    milestones.forEach(function(m) {
      if (days <= m.daysOut && days > 0) {
        upcoming.push({...m, orchestra: getShortName(a), daysLeft: days});
      }
    });
  });
  if (!upcoming.length) return null;
  upcoming.sort(function(a,b) { return a.daysLeft - b.daysLeft; });

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800">🎯 Run-Through Milestones</h4>
        {onSwitchTab && (
          <button onClick={function(){onSwitchTab("milestones")}} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">View all →</button>
        )}
      </div>
      <p className="text-xs text-gray-500">{upcoming.length} milestone{upcoming.length !== 1 ? "s" : ""} active right now.</p>
    </div>
  );
}

function MilestonesTab(props) {
  var auditions = props.auditions;
  var settings = props.settings;
  var milestoneNotes = props.milestoneNotes;
  var milestoneComplete = props.milestoneComplete;
  var onSaveNote = props.onSaveNote;
  var onToggleComplete = props.onToggleComplete;

  var active = auditions.filter(function(a) {
    return ["Preparing","Applied","Scheduled"].indexOf(a.status) >= 0 && a.date;
  });

  var milestones = settings.runThroughMilestones || DEFAULT_SETTINGS.runThroughMilestones;

  var allMilestones = useMemo(function() {
    var result = [];
    active.forEach(function(a) {
      var days = daysUntil(a.date);
      milestones.forEach(function(m) {
        var mKey = a.id + "::" + m.label;
        var targetDate = new Date(a.date + "T12:00:00");
        targetDate.setDate(targetDate.getDate() - m.daysOut);
        result.push({
          key: mKey,
          auditionId: a.id,
          orchestra: a.orchestra,
          shortName: getShortName(a),
          auditionDate: a.date,
          daysToAudition: days,
          label: m.label,
          type: m.type,
          daysOut: m.daysOut,
          targetDate: localDateStr(targetDate),
          daysUntilMilestone: daysUntil(localDateStr(targetDate)),
          completed: !!(milestoneComplete && milestoneComplete[mKey]),
          note: (milestoneNotes && milestoneNotes[mKey]) || "",
        });
      });
    });
    result.sort(function(a, b) { return a.daysUntilMilestone - b.daysUntilMilestone; });
    return result;
  }, [active, milestones, milestoneNotes, milestoneComplete]);

  var overdue = allMilestones.filter(function(m) { return m.daysUntilMilestone < 0 && !m.completed; });
  var thisWeek = allMilestones.filter(function(m) { return m.daysUntilMilestone >= 0 && m.daysUntilMilestone <= 7 && !m.completed; });
  var later = allMilestones.filter(function(m) { return m.daysUntilMilestone > 7 && !m.completed; });
  var done = allMilestones.filter(function(m) { return m.completed; });

  var typeColors = {
    informal: "border-l-blue-400",
    runthrough: "border-l-purple-400",
    mock: "border-l-amber-400",
    dress: "border-l-red-400"
  };
  var typeIcons = {
    informal: "🎵",
    runthrough: "🎶",
    mock: "🎭",
    dress: "👔"
  };

  function MilestoneCard(cardProps) {
    var m = cardProps.m;
    var [noteOpen, setNoteOpen] = useState(false);
    var [draft, setDraft] = useState(m.note);
    var [editing, setEditing] = useState(false);

    function saveNote() {
      onSaveNote(m.key, draft);
      setEditing(false);
    }

    return (
      <div className={"bg-white border border-gray-200 border-l-4 rounded-lg p-3 space-y-2 " + (typeColors[m.type] || "border-l-gray-400") + (m.completed ? " opacity-60" : "")}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span>{typeIcons[m.type] || "🎯"}</span>
              <span className={"text-sm font-medium " + (m.completed ? "line-through text-gray-400" : "text-gray-900")}>{m.label}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-indigo-600 font-medium">{m.shortName}</span>
              <span className="text-xs text-gray-400">·</span>
              <span className="text-xs text-gray-400">Audition {fmtDate(m.auditionDate)}</span>
              <span className="text-xs text-gray-400">·</span>
              <span className={"text-xs font-medium " + (m.daysUntilMilestone < 0 ? "text-red-500" : m.daysUntilMilestone <= 3 ? "text-amber-600" : "text-gray-500")}>
                {m.daysUntilMilestone < 0 ? Math.abs(m.daysUntilMilestone) + "d overdue" : m.daysUntilMilestone === 0 ? "Today" : "in " + m.daysUntilMilestone + "d"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={function(){onToggleComplete(m.key, !m.completed)}}
              className={"w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors " + (m.completed ? "bg-green-500 border-green-500 text-white" : "border-gray-300 hover:border-green-400")}
              title={m.completed ? "Mark incomplete" : "Mark complete"}
            >
              {m.completed && <span style={{fontSize: 12}}>✓</span>}
            </button>
          </div>
        </div>
        {/* Notes section */}
        <div className="flex items-center gap-2">
          {m.note && !editing ? (
            <button onClick={function(){setNoteOpen(!noteOpen)}} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium flex items-center gap-1">
              📝 {noteOpen ? "hide notes" : "view notes"}
            </button>
          ) : null}
          {!m.note && !editing ? (
            <button onClick={function(){setEditing(true); setDraft("")}} className="text-xs text-gray-400 hover:text-indigo-500 flex items-center gap-1">
              📝 add notes
            </button>
          ) : null}
          {m.note && !editing ? (
            <button onClick={function(){setEditing(true); setDraft(m.note)}} className="text-xs text-gray-400 hover:text-indigo-500">
              edit
            </button>
          ) : null}
        </div>
        {noteOpen && m.note && !editing && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap">
            {m.note}
          </div>
        )}
        {editing && (
          <div className="space-y-2">
            <textarea
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none leading-relaxed"
              rows={3}
              value={draft}
              onChange={function(e){setDraft(e.target.value)}}
              placeholder="How did it go? What did you learn? What to adjust for the real thing?"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button onClick={function(){setEditing(false)}} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">Cancel</button>
              <button onClick={saveNote} className="text-xs bg-indigo-600 text-white px-3 py-1 rounded-lg hover:bg-indigo-700">Save</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function MilestoneSection(secProps) {
    if (!secProps.items.length) return null;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h4 className={"text-sm font-semibold " + secProps.color}>{secProps.title}</h4>
          <span className="text-xs text-gray-400">{secProps.items.length}</span>
        </div>
        {secProps.items.map(function(m) { return <MilestoneCard key={m.key} m={m} />; })}
      </div>
    );
  }

  if (!active.length) return (<p className="text-sm text-gray-400 text-center py-8">No active auditions with dates set.</p>);
  if (allMilestones.length === 0) return (<p className="text-sm text-gray-400 text-center py-8">No milestones configured. Add them in Settings.</p>);

  var totalCount = allMilestones.length;
  var doneCount = done.length;

  return (
    <div className="space-y-5">
      {/* Progress overview */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-800">🎯 Milestone Progress</h4>
          <span className="text-xs text-gray-400">{doneCount}/{totalCount} complete</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div className="bg-green-500 h-2 rounded-full transition-all" style={{width: (totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0) + "%"}} />
        </div>
      </div>

      <MilestoneSection title="🔴 Overdue" color="text-red-600" items={overdue} />
      <MilestoneSection title="🟡 This Week" color="text-amber-600" items={thisWeek} />
      <MilestoneSection title="🟢 Coming Up" color="text-gray-600" items={later} />

      {done.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-green-600">✅ Completed ({done.length})</h4>
          {done.map(function(m) { return <MilestoneCard key={m.key} m={m} />; })}
        </div>
      )}
    </div>
  );
}

function SettingsPanel(props) {
  var settings = props.settings;
  var onUpdate = props.onUpdate;
  var [et, setEt] = useState(settings.excerptTimerMins);
  var [st, setSt] = useState(settings.sessionTimerMins);
  var [miles, setMiles] = useState(settings.runThroughMilestones || DEFAULT_SETTINGS.runThroughMilestones);
  var [newM, setNewM] = useState({daysOut:"", label:"", type:"informal"});

  function save() {
    onUpdate({...settings, excerptTimerMins: parseInt(et) || 20, sessionTimerMins: parseInt(st) || 120, runThroughMilestones: miles});
  }

  function addMilestone() {
    if (!newM.daysOut || !newM.label) return;
    var updated = [...miles, {daysOut: parseInt(newM.daysOut), label: newM.label, type: newM.type}];
    updated.sort(function(a,b) { return b.daysOut - a.daysOut; });
    setMiles(updated);
    setNewM({daysOut:"", label:"", type:"informal"});
  }

  function removeMilestone(idx) {
    setMiles(miles.filter(function(_, j) { return j !== idx; }));
  }

  function resetDefaults() {
    setEt(DEFAULT_SETTINGS.excerptTimerMins);
    setSt(DEFAULT_SETTINGS.sessionTimerMins);
    setMiles(JSON.parse(JSON.stringify(DEFAULT_SETTINGS.runThroughMilestones)));
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h3 className="font-semibold text-gray-800">Timer Defaults</h3>
        <div className="grid grid-cols-2 gap-4">
          <Inp label="Excerpt timer (minutes)" type="number" value={et} onChange={function(e){setEt(e.target.value)}} min={1} />
          <Inp label="Session timer (minutes)" type="number" value={st} onChange={function(e){setSt(e.target.value)}} min={1} />
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h3 className="font-semibold text-gray-800">Run-Through Milestones</h3>
        <p className="text-xs text-gray-500">Configure when to schedule play-throughs, mock auditions, etc.</p>
        <div className="space-y-2">
          {miles.map(function(m, i) {
            return (
              <div key={i} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2">
                <span className="font-medium text-indigo-600 w-12 shrink-0">{m.daysOut}d</span>
                <span className="flex-1">{m.label}</span>
                <span className="text-xs text-gray-400">{m.type}</span>
                <button onClick={function(){removeMilestone(i)}} className="text-gray-300 hover:text-red-500">&times;</button>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2 flex-wrap items-end border-t border-gray-100 pt-3">
          <Inp label="Days before" type="number" value={newM.daysOut} onChange={function(e){setNewM({...newM, daysOut: e.target.value})}} placeholder="14" style={{width:80}} />
          <Inp label="Description" value={newM.label} onChange={function(e){setNewM({...newM, label: e.target.value})}} placeholder="Play for a friend" />
          <Sel label="Type" value={newM.type} onChange={function(e){setNewM({...newM, type: e.target.value})}} options={["informal","runthrough","mock","dress"]} />
          <Btn onClick={addMilestone} disabled={!newM.daysOut || !newM.label}>Add</Btn>
        </div>
      </div>
      <div className="flex gap-2">
        <Btn onClick={save}>Save Settings</Btn>
        <Btn variant="secondary" onClick={resetDefaults}>Reset to Defaults</Btn>
      </div>
    </div>
  );
}

function PrepPlanner(props) {
  var auditions = props.auditions;
  var readiness = props.readiness;
  var onSetReadiness = props.onSetReadiness;
  var practiceLog = props.practiceLog;
  var settings = props.settings;
  var onSwitchTab = props.onSwitchTab;

  var active = auditions.filter(function(a) {
    return ["Preparing","Applied","Scheduled"].indexOf(a.status) >= 0;
  });

  var excerptMap = useMemo(function() {
    var map = {};
    active.forEach(function(a) {
      (a.excerpts || []).forEach(function(e) {
        var key = normExcerpt(e);
        if (!map[key]) map[key] = {key: key, label: excLabel(e), auditions: [], excerptIds: []};
        map[key].auditions.push({id: a.id, orchestra: getShortName(a), date: a.date, daysLeft: daysUntil(a.date)});
        map[key].excerptIds.push(e.id);
      });
    });
    return map;
  }, [active]);

  var scored = useMemo(function() {
    return Object.values(excerptMap).map(function(ex) {
      var closestDays = Math.min.apply(null, ex.auditions.map(function(a){return a.daysLeft}));
      var n = ex.auditions.length;
      var rLevel = readiness[ex.key] || "Not Started";
      var score = Math.max(0, closestDays) + (RVAL[rLevel] * 15) + (n * -20);
      return {...ex, closestDays: closestDays, numAuditions: n, readinessLevel: rLevel, score: score};
    }).sort(function(a,b){return a.score - b.score});
  }, [excerptMap, readiness]);

  var practiceTotals = useMemo(function() {
    var t = {};
    practiceLog.forEach(function(p) {
      var a = auditions.find(function(x){return x.id === p.auditionId});
      if (!a) return;
      var ex = a.excerpts.find(function(e){return e.id === p.excerptId});
      if (!ex) return;
      var key = normExcerpt(ex);
      t[key] = (t[key] || 0) + p.minutes;
    });
    return t;
  }, [practiceLog, auditions]);

  var practiceByExcerpt = useMemo(function() {
    var map = {};
    practiceLog.forEach(function(p) {
      var a = auditions.find(function(x){return x.id === p.auditionId});
      if (!a) return;
      var ex = a.excerpts.find(function(e){return e.id === p.excerptId});
      if (!ex) return;
      var key = normExcerpt(ex);
      if (!map[key]) map[key] = [];
      map[key].push(p);
    });
    return map;
  }, [practiceLog, auditions]);

  var thisWeek = scored.filter(function(e){return e.closestDays <= 7});
  var nextWeeks = scored.filter(function(e){return e.closestDays > 7 && e.closestDays <= 21});
  var later = scored.filter(function(e){return e.closestDays > 21});
  var highROI = scored.filter(function(e){return e.numAuditions >= 2});

  function ExRow(rowProps) {
    var ex = rowProps.ex;
    var practiced = practiceTotals[ex.key] || 0;
    var sessions = practiceByExcerpt[ex.key] || [];
    var [showHistory, setShowHistory] = useState(false);

    // Calculate days since last practice
    var daysSincePractice = null;
    if (sessions.length > 0) {
      var dates = sessions.map(function(s) { return s.date; }).sort().reverse();
      daysSincePractice = daysUntil(dates[0]) * -1; // negative because daysUntil counts forward
      // recalc properly
      var lastDate = new Date(dates[0] + "T12:00:00");
      var now = new Date();
      now.setHours(0,0,0,0);
      lastDate.setHours(0,0,0,0);
      daysSincePractice = Math.floor((now - lastDate) / 864e5);
    }
    var needsNudge = (sessions.length === 0 && practiced === 0) || (daysSincePractice !== null && daysSincePractice >= 3);

    var birdMessages = [
      "Psst... you haven't practiced this in " + (daysSincePractice || "a while") + " days. Time to look at it?",
      "Hey! This one misses you. It's been " + (daysSincePractice || "a while") + " days!",
      "Chirp! " + (daysSincePractice || "A few") + " days without this one. Give it some love?",
    ];
    var noPracticeMessages = [
      "Psst... you haven't practiced this one yet!",
      "This excerpt is waiting for its first practice session!",
      "Hey! Don't forget about this one — give it a try?",
    ];
    var nudgeMsg = sessions.length === 0 ? noPracticeMessages[Math.floor(Math.random() * noPracticeMessages.length)] : birdMessages[Math.floor(Math.random() * birdMessages.length)];

    return (
      <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-gray-900 text-sm">{ex.label}</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {ex.auditions.map(function(a, i) {
                return (<span key={i} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{a.orchestra} ({a.daysLeft <= 0 ? "past" : a.daysLeft + "d"})</span>);
              })}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {ex.numAuditions > 1 && (<span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">x{ex.numAuditions} lists</span>)}
            {practiced > 0 && (
              <button
                onClick={function(){setShowHistory(!showHistory)}}
                className="text-xs text-indigo-500 hover:text-indigo-700 font-medium flex items-center gap-1 transition-colors"
              >
                {minsToHM(practiced)} practiced
                <span className={"inline-block transition-transform " + (showHistory ? "rotate-180" : "")} style={{fontSize: 10}}>▼</span>
              </button>
            )}
            {sessions.length === 0 && practiced === 0 && (
              <span className="text-xs text-gray-300 italic">No sessions yet</span>
            )}
          </div>
        </div>
        {needsNudge && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <span className="text-lg shrink-0">🐦</span>
            <div className="relative">
              <div className="absolute -left-1 top-1.5 w-2 h-2 bg-amber-50 border-l border-b border-amber-200 rotate-45 -ml-1.5" />
              <p className="text-xs text-amber-800 italic relative z-10">{nudgeMsg}</p>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-gray-500 mr-1">Readiness:</span>
          {READINESS.map(function(r) {
            return (
              <button key={r} onClick={function(){onSetReadiness(ex.key, r)}} className={"text-xs px-2 py-0.5 rounded-full transition-colors " + (ex.readinessLevel === r ? READINESS_COLORS[r] : "bg-gray-50 text-gray-400 hover:bg-gray-100")}>
                {r}
              </button>
            );
          })}
        </div>
        {showHistory && sessions.length > 0 && (
          <div className="border-t border-gray-100 pt-2 mt-1 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">Practice History</span>
              <span className="text-xs text-gray-400">{sessions.length} session{sessions.length !== 1 ? "s" : ""}</span>
            </div>
            {sessions.map(function(p) {
              var hasLongNote = p.note && (p.note.length > 60 || p.note.indexOf("\n") >= 0);
              return (
                <PlannerSessionRow key={p.id} p={p} hasLongNote={hasLongNote} />
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function PlannerSessionRow(rowProps) {
    var p = rowProps.p;
    var hasLongNote = rowProps.hasLongNote;
    var [noteOpen, setNoteOpen] = useState(false);
    return (
      <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-gray-400 shrink-0">{fmtDate(p.date)}</span>
            <span className="text-indigo-600 font-medium shrink-0">{minsToHM(p.minutes)}</span>
            {p.note && !hasLongNote && (
              <span className="text-gray-500 truncate">— {p.note}</span>
            )}
          </div>
          {hasLongNote && (
            <button
              onClick={function(){setNoteOpen(!noteOpen)}}
              className="text-indigo-500 hover:text-indigo-700 font-medium ml-2 shrink-0 flex items-center gap-0.5"
            >
              📝 {noteOpen ? "hide" : "notes"}
            </button>
          )}
        </div>
        {noteOpen && p.note && (
          <div className="mt-1.5 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap">
            {p.note}
          </div>
        )}
      </div>
    );
  }

  function Section(secProps) {
    if (!secProps.items.length) return null;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h4 className={"text-sm font-semibold " + secProps.color}>{secProps.title}</h4>
          <span className="text-xs text-gray-400">{secProps.sub}</span>
        </div>
        {secProps.items.map(function(ex) { return (<ExRow key={ex.key} ex={ex} />); })}
      </div>
    );
  }

  var [showRanking, setShowRanking] = useState(true);
  var [showROI, setShowROI] = useState(false);

  if (!active.length) return (<p className="text-sm text-gray-400 text-center py-8">No active auditions to plan for.</p>);
  if (!scored.length) return (<p className="text-sm text-gray-400 text-center py-8">Add rep lists to your auditions to see the prep plan.</p>);

  return (
    <div className="space-y-5">
      <RunThroughPanel auditions={auditions} settings={settings} onSwitchTab={onSwitchTab} />
      <div className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden">
        <button onClick={function(){setShowRanking(!showRanking)}} className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-100 transition-colors">
          <div>
            <h4 className="text-sm font-semibold text-gray-700 text-left">Full Priority Ranking</h4>
            <p className="text-xs text-gray-500 text-left">Scored by deadline + overlap + readiness</p>
          </div>
          <span className={"text-gray-400 transition-transform " + (showRanking ? "rotate-180" : "")}>▼</span>
        </button>
        {showRanking && (
          <div className="px-4 pb-3 space-y-1">
            {scored.map(function(ex, i) {
              return (
                <div key={ex.key} className="flex items-center gap-2 text-sm py-1">
                  <span className={"w-6 text-right font-bold " + (i < 3 ? "text-red-600" : i < 8 ? "text-amber-600" : "text-gray-400")}>{i + 1}</span>
                  <span className="flex-1 text-gray-800">{ex.label}</span>
                  <span className="text-xs text-gray-400">{ex.closestDays <= 0 ? "past" : ex.closestDays + "d"}</span>
                  {ex.numAuditions > 1 && (<span className="text-xs text-emerald-600">x{ex.numAuditions}</span>)}
                  <RBadge level={ex.readinessLevel} />
                </div>
              );
            })}
          </div>
        )}
      </div>
      {highROI.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl overflow-hidden">
          <button onClick={function(){setShowROI(!showROI)}} className="w-full px-4 py-3 flex items-center justify-between hover:bg-emerald-100 transition-colors">
            <div>
              <h4 className="text-sm font-semibold text-emerald-800 text-left">Highest ROI — on multiple lists</h4>
              <p className="text-xs text-emerald-600 text-left">Nail these to cover ground across auditions</p>
            </div>
            <span className={"text-emerald-400 transition-transform " + (showROI ? "rotate-180" : "")}>▼</span>
          </button>
          {showROI && (
            <div className="px-4 pb-3 space-y-1">
              {highROI.map(function(ex) {
                return (
                  <div key={ex.key} className="flex items-center justify-between text-sm">
                    <span className="text-emerald-800">{ex.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-emerald-600 font-medium">x{ex.numAuditions}</span>
                      <RBadge level={ex.readinessLevel} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <Section title="🔴 This Week" sub="Auditions within 7 days" color="text-red-700" items={thisWeek} />
      <Section title="🟡 Next 2-3 Weeks" sub="Auditions within 21 days" color="text-amber-700" items={nextWeeks} />
      <Section title="🟢 Can Build Over Time" sub="21+ days out" color="text-gray-600" items={later} />
    </div>
  );
}

function PracticeChart(props) {
  var practiceLog = props.practiceLog;
  var [range, setRange] = useState("7days");

  var chartData = useMemo(function() {
    var today = new Date();
    today.setHours(0,0,0,0);
    var dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

    function buildDays(count) {
      var days = [];
      for (var i = count - 1; i >= 0; i--) {
        var d = new Date(today);
        d.setDate(d.getDate() - i);
        days.push(localDateStr(d));
      }
      var dayMap = {};
      days.forEach(function(k) { dayMap[k] = 0; });
      practiceLog.forEach(function(p) {
        if (dayMap[p.date] !== undefined) dayMap[p.date] += p.minutes;
      });
      return days.map(function(d) {
        var dt = new Date(d + "T12:00:00");
        return { label: dayNames[dt.getDay()] + " " + (dt.getMonth()+1) + "/" + dt.getDate(), value: dayMap[d] };
      });
    }

    if (range === "3days") return buildDays(3);
    if (range === "7days") return buildDays(7);
    if (range === "14days") return buildDays(14);

    if (range === "weeks") {
      // Last 8 weeks
      var weeks = [];
      for (var w = 7; w >= 0; w--) {
        var weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() - (w * 7));
        var weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        weeks.push({ start: weekStart, end: weekEnd, startStr: localDateStr(weekStart), endStr: localDateStr(weekEnd), minutes: 0 });
      }
      practiceLog.forEach(function(p) {
        if (!p.date) return;
        weeks.forEach(function(wk) {
          if (p.date >= wk.startStr && p.date <= wk.endStr) wk.minutes += p.minutes;
        });
      });
      return weeks.map(function(wk) {
        return { label: (wk.start.getMonth()+1) + "/" + wk.start.getDate(), value: wk.minutes };
      });
    }

    // months — last 6 months
    var months = [];
    for (var m = 5; m >= 0; m--) {
      var md = new Date(today.getFullYear(), today.getMonth() - m, 1);
      var key = localDateStr(md).slice(0, 7);
      var monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      months.push({ key: key, label: monthNames[md.getMonth()], minutes: 0 });
    }
    practiceLog.forEach(function(p) {
      if (!p.date) return;
      var pk = p.date.slice(0, 7);
      months.forEach(function(mo) {
        if (mo.key === pk) mo.minutes += p.minutes;
      });
    });
    return months.map(function(mo) {
      return { label: mo.label, value: mo.minutes };
    });
  }, [practiceLog, range]);

  var maxVal = Math.max.apply(null, chartData.map(function(d) { return d.value; }).concat([1]));

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">📊 Practice Overview</h4>
        <div className="flex gap-1">
          {[["7days","7 Days"],["14days","14 Days"],["weeks","8 Weeks"],["months","6 Months"]].map(function(item) {
            return (
              <button key={item[0]} onClick={function(){setRange(item[0])}} className={"text-xs px-2 py-1 rounded transition-colors " + (range === item[0] ? "bg-indigo-100 text-indigo-700 font-medium" : "text-gray-400 hover:text-gray-600")}>
                {item[1]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-end gap-1" style={{height: 120}}>
        {chartData.map(function(d, i) {
          var pct = maxVal > 0 ? (d.value / maxVal) * 100 : 0;
          var barH = Math.max(pct, d.value > 0 ? 4 : 0);
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full relative">
              {d.value > 0 && (
                <div className="text-xs text-indigo-600 font-medium mb-0.5" style={{fontSize: 9}}>
                  {minsToHM(d.value)}
                </div>
              )}
              <div
                className={"w-full rounded-t transition-all duration-300 " + (d.value > 0 ? "bg-indigo-500" : "bg-gray-100")}
                style={{height: barH + "%", minHeight: d.value > 0 ? 3 : 1}}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1">
        {chartData.map(function(d, i) {
          return (
            <div key={i} className="flex-1 text-center">
              <span className="text-gray-400 block leading-tight" style={{fontSize: 9}}>{d.label}</span>
            </div>
          );
        })}
      </div>
      <div className="text-center text-xs text-gray-400">
        Total: <span className="text-indigo-600 font-medium">{minsToHM(chartData.reduce(function(s,d){return s+d.value},0))}</span>
      </div>
    </div>
  );
}

function NotepadModal(props) {
  var value = props.value;
  var onChange = props.onChange;
  var onClose = props.onClose;
  var excerptLabel = props.excerptLabel || "";
  var minutes = props.minutes || "";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden" style={{height: "min(520px, 75vh)"}} onClick={function(e){e.stopPropagation()}}>
        <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">📝</span>
            <span className="font-semibold text-gray-800 text-sm">Practice Notes</span>
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-lg transition-colors">✕</button>
        </div>
        {(excerptLabel || minutes) && (
          <div className="px-5 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-3">
            {excerptLabel && <span className="text-sm text-indigo-700 font-medium">{excerptLabel}</span>}
            {minutes && <span className="text-xs text-gray-400 bg-white border border-gray-200 rounded-full px-2 py-0.5">{minutes} min</span>}
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          <textarea
            className="w-full h-full resize-none px-5 py-4 text-sm text-gray-800 bg-white focus:outline-none leading-relaxed"
            value={value}
            onChange={function(e){onChange(e.target.value)}}
            placeholder="What did you work on? How did it feel? What needs attention next time?&#10;&#10;Write as much as you want..."
            autoFocus
          />
        </div>
        <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className="text-xs text-gray-400">{value.length > 0 ? value.split(/\s+/).filter(Boolean).length + " words" : "Start writing..."}</span>
          <button onClick={onClose} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function ExpandableNote(props) {
  var note = props.note;
  var [expanded, setExpanded] = useState(false);
  if (!note) return null;
  var isLong = note.length > 50 || note.indexOf("\n") >= 0;
  if (!isLong) {
    return <span className="text-gray-400 ml-2">— {note}</span>;
  }
  var preview = note.slice(0, 50).split("\n")[0];
  if (!expanded) {
    return (
      <span className="ml-2">
        <span className="text-gray-400">— {preview}...</span>
        <button onClick={function(e){e.stopPropagation(); setExpanded(true)}} className="text-indigo-500 hover:text-indigo-700 text-xs ml-1 font-medium">
          more
        </button>
      </span>
    );
  }
  return (
    <div className="mt-1.5 ml-0">
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap">
        {note}
      </div>
      <button onClick={function(e){e.stopPropagation(); setExpanded(false)}} className="text-indigo-500 hover:text-indigo-700 text-xs mt-1 font-medium">
        show less
      </button>
    </div>
  );
}

function PracticeTab(props) {
  var auditions = props.auditions;
  var practiceLog = props.practiceLog;
  var onAdd = props.onAdd;
  var onDelete = props.onDelete;
  var settings = props.settings;

  var allEx = useMemo(function() {
    var o = [];
    auditions.forEach(function(a) {
      var short = getShortName(a);
      (a.excerpts || []).forEach(function(e) {
        o.push({auditionId: a.id, excerptId: e.id, label: excLabel(e), orchestra: a.orchestra, short: short});
      });
    });
    return o;
  }, [auditions]);

  var [sel, setSel] = useState("");
  var [mins, setMins] = useState("");
  var [note, setNote] = useState("");
  var [birdMsg, setBirdMsg] = useState(null);
  var [notepadOpen, setNotepadOpen] = useState(false);

  function submit() {
    if (!sel || !mins) return;
    var ex = allEx.find(function(e){return e.excerptId === sel});
    onAdd({id: gid(), excerptId: sel, auditionId: ex.auditionId, label: ex.label, orchestra: ex.orchestra, short: ex.short, minutes: parseInt(mins, 10), note: note, date: localDateStr()});
    setMins("");
    setNote("");
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TimerWidget defaultMins={settings.excerptTimerMins} mode="excerpt" onComplete={function(){setBirdMsg("Time to move on! 🎵")}} />
        <TimerWidget defaultMins={settings.sessionTimerMins} mode="session" onComplete={function(){setBirdMsg("Time to stop! Great work today. 🎶")}} />
      </div>
      {birdMsg && (<BirdPopup message={birdMsg} onClose={function(){setBirdMsg(null)}} />)}
      <PracticeChart practiceLog={practiceLog} />
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h4 className="text-sm font-medium text-gray-700">Log Practice</h4>
        {allEx.length === 0 ? (
          <p className="text-sm text-gray-500">Add excerpts to an audition first.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap items-end">
              <div className="flex flex-col gap-1 flex-1 min-w-48">
                <label className="text-xs font-medium text-gray-600">Excerpt</label>
                <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" value={sel} onChange={function(e){setSel(e.target.value)}}>
                  <option value="">Select...</option>
                  {allEx.map(function(e) { return (<option key={e.excerptId} value={e.excerptId}>{e.short}: {e.label}</option>); })}
                </select>
              </div>
              <Inp label="Minutes" type="number" value={mins} onChange={function(e){setMins(e.target.value)}} placeholder="30" style={{width:80}} />
              <Btn onClick={submit} disabled={!sel || !mins}>Log</Btn>
            </div>
            {/* Note button + preview */}
            <div className="flex items-start gap-2">
              <button
                onClick={function(){setNotepadOpen(true)}}
                className={"flex items-center gap-2 text-sm px-3 py-2 rounded-lg border transition-colors w-full text-left " + (note ? "bg-indigo-50 border-indigo-200 text-indigo-800" : "bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100 hover:text-gray-600")}
              >
                <span>📝</span>
                {note ? (
                  <span className="flex-1 truncate">{note.split("\n")[0]}</span>
                ) : (
                  <span className="flex-1">Add practice notes...</span>
                )}
                {note && <span className="text-xs text-indigo-400 shrink-0">{note.split(/\s+/).filter(Boolean).length}w</span>}
              </button>
              {note && (
                <button onClick={function(){setNote("")}} className="text-gray-300 hover:text-red-400 mt-2 shrink-0" title="Clear note">&times;</button>
              )}
            </div>
          </div>
        )}
      </div>
      {notepadOpen && (function() {
        var selEx = sel ? allEx.find(function(e){return e.excerptId === sel}) : null;
        var label = selEx ? selEx.short + ": " + selEx.label : "";
        return <NotepadModal value={note} onChange={setNote} onClose={function(){setNotepadOpen(false)}} excerptLabel={label} minutes={mins} />;
      })()}
      {practiceLog.length > 0 && (function() {
        var grouped = {};
        practiceLog.slice(0, 50).forEach(function(p) {
          var key = p.date || "Unknown";
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(p);
        });
        var sortedDates = Object.keys(grouped).sort(function(a, b) {
          return b.localeCompare(a);
        });
        var today = localDateStr();
        var yd = new Date(); yd.setDate(yd.getDate() - 1);
        var yesterday = localDateStr(yd);
        function dateLabel(d) {
          if (d === today) return "Today";
          if (d === yesterday) return "Yesterday";
          if (d === "Unknown") return "Unknown Date";
          return fmtDate(d);
        }
        function dayTotal(entries) {
          return entries.reduce(function(s, p) { return s + p.minutes; }, 0);
        }
        return (
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-gray-600">Recent Sessions</h4>
            {sortedDates.map(function(date) {
              var entries = grouped[date];
              return (
                <div key={date} className="space-y-1">
                  <div className="flex items-center justify-between border-b border-gray-200 pb-1 mb-1">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{dateLabel(date)}</span>
                    <span className="text-xs text-indigo-500 font-medium">{minsToHM(dayTotal(entries))}</span>
                  </div>
                  {entries.map(function(p) {
                    return (
                      <div key={p.id} className="bg-white border border-gray-100 rounded-lg px-3 py-2 text-sm">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-gray-700">{p.label}</span>
                            <span className="text-gray-400 ml-2">({p.short || p.orchestra})</span>
                            {p.note && !p.note.match(/\n/) && p.note.length <= 50 && (
                              <ExpandableNote note={p.note} />
                            )}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-indigo-600 font-medium">{minsToHM(p.minutes)}</span>
                            <button onClick={function(){onDelete(p.id)}} className="text-gray-300 hover:text-red-400">&times;</button>
                          </div>
                        </div>
                        {p.note && (p.note.match(/\n/) || p.note.length > 50) && (
                          <ExpandableNote note={p.note} />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })()}
      {practiceLog.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-sm font-medium text-gray-600">Totals by Excerpt</h4>
          {Object.values(practiceLog.reduce(function(acc, p) {
            if (!acc[p.excerptId]) acc[p.excerptId] = {label: p.label, orchestra: p.short || p.orchestra, minutes: 0};
            acc[p.excerptId].minutes += p.minutes;
            return acc;
          }, {})).sort(function(a,b){return b.minutes - a.minutes}).map(function(s, i) {
            return (
              <div key={i} className="flex justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                <span>{s.label} <span className="text-gray-400">({s.orchestra})</span></span>
                <span className="font-medium text-indigo-600">{minsToHM(s.minutes)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConductorAvatar(props) {
  var mood = props.mood || "idle";
  var size = props.size || 48;
  // Cartoon conductor: round face, top hat, baton, expressive eyes
  var eyeL = mood === "thinking" ? "—" : mood === "happy" ? "◠" : "●";
  var eyeR = mood === "thinking" ? "—" : mood === "happy" ? "◠" : "●";
  var mouth = mood === "happy" ? "◡" : mood === "thinking" ? "○" : "‿";
  var hatTilt = mood === "happy" ? -5 : mood === "thinking" ? 5 : 0;
  var batonAngle = mood === "thinking" ? 20 : mood === "happy" ? -15 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={mood === "thinking" ? "animate-pulse" : ""}>
      {/* Body / coat */}
      <ellipse cx="50" cy="88" rx="22" ry="14" fill="#1e1b4b" />
      {/* White shirt front */}
      <ellipse cx="50" cy="85" rx="10" ry="8" fill="white" opacity="0.9" />
      {/* Bow tie */}
      <polygon points="45,78 50,81 55,78 55,84 50,81 45,84" fill="#ef4444" />
      {/* Head */}
      <circle cx="50" cy="55" r="22" fill="#fcd34d" />
      {/* Rosy cheeks */}
      <circle cx="36" cy="60" r="5" fill="#fca5a5" opacity="0.5" />
      <circle cx="64" cy="60" r="5" fill="#fca5a5" opacity="0.5" />
      {/* Eyes */}
      <text x="40" y="56" textAnchor="middle" fontSize="10" fill="#1e1b4b">{eyeL}</text>
      <text x="60" y="56" textAnchor="middle" fontSize="10" fill="#1e1b4b">{eyeR}</text>
      {/* Mouth */}
      <text x="50" y="68" textAnchor="middle" fontSize={mood === "happy" ? "14" : "10"} fill="#1e1b4b">{mouth}</text>
      {/* Top hat */}
      <g transform={"rotate(" + hatTilt + " 50 30)"}>
        <rect x="32" y="18" width="36" height="22" rx="3" fill="#1e1b4b" />
        <rect x="27" y="37" width="46" height="5" rx="2" fill="#1e1b4b" />
        <rect x="34" y="30" width="32" height="3" rx="1" fill="#6366f1" />
      </g>
      {/* Baton */}
      <g transform={"rotate(" + batonAngle + " 76 70)"}>
        <line x1="74" y1="70" x2="96" y2="50" stroke="#92400e" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="96" cy="49" r="2" fill="white" />
      </g>
    </svg>
  );
}

function ConductorChat(props) {
  var auditions = props.auditions;
  var practiceLog = props.practiceLog;
  var readiness = props.readiness;
  var [open, setOpen] = useState(false);
  var messages = props.messages;
  var setMessages = props.onSetMessages;
  var [input, setInput] = useState("");
  var [loading, setLoading] = useState(false);
  var messagesEndRef = useRef(null);

  var mood = loading ? "thinking" : messages.length > 0 && messages[messages.length - 1].role === "assistant" ? "happy" : "idle";

  useEffect(function() {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({behavior: "smooth"});
    }
  }, [messages]);

  // Idle greetings based on time of day
  function getGreeting() {
    var h = new Date().getHours();
    if (h < 12) return "Good morning! Ready to warm up?";
    if (h < 17) return "Good afternoon! Let's make today count.";
    if (h < 21) return "Good evening! Perfect time for some focused practice.";
    return "Burning the midnight oil? I admire the dedication!";
  }

  function buildContext() {
    var active = auditions.filter(function(a) {
      return ["Preparing","Applied","Scheduled"].indexOf(a.status) >= 0;
    });
    var lines = [];
    lines.push("AUDITION DATA:");
    if (active.length === 0) {
      lines.push("No active auditions.");
    }
    active.forEach(function(a) {
      var d = daysUntil(a.date);
      lines.push("");
      lines.push("- " + a.orchestra + " (" + getShortName(a) + ") — " + (a.date ? fmtDate(a.date) + " (" + (d > 0 ? d + " days away" : "past") + ")" : "No date set") + " — Status: " + a.status);
      if (a.round) lines.push("  Round: " + a.round);
      if (a.notes) lines.push("  Notes: " + a.notes);
      if (a.excerpts && a.excerpts.length > 0) {
        lines.push("  Excerpts:");
        a.excerpts.forEach(function(e) {
          var key = normExcerpt(e);
          var rLevel = (readiness || {})[key] || "Not Started";
          lines.push("    · " + excLabel(e) + " — Readiness: " + rLevel);
        });
      }
    });
    var totalMins = practiceLog.reduce(function(s,p){return s + p.minutes}, 0);
    var last7 = practiceLog.filter(function(p) {
      if (!p.date) return false;
      var d = new Date(p.date + "T12:00:00");
      var now = new Date();
      return (now - d) < 7 * 864e5;
    });
    var last7Mins = last7.reduce(function(s,p){return s + p.minutes}, 0);
    lines.push("");
    lines.push("PRACTICE SUMMARY:");
    lines.push("- Total all time: " + minsToHM(totalMins));
    lines.push("- Last 7 days: " + minsToHM(last7Mins) + " across " + last7.length + " sessions");
    var byExcerpt = {};
    practiceLog.slice(0, 50).forEach(function(p) {
      if (!byExcerpt[p.label]) byExcerpt[p.label] = {minutes: 0, notes: [], orchestra: p.short || p.orchestra};
      byExcerpt[p.label].minutes += p.minutes;
      if (p.note) byExcerpt[p.label].notes.push(p.note);
    });
    var excKeys = Object.keys(byExcerpt);
    if (excKeys.length > 0) {
      lines.push("");
      lines.push("PRACTICE BY EXCERPT (recent):");
      excKeys.forEach(function(k) {
        var e = byExcerpt[k];
        lines.push("- " + k + " (" + e.orchestra + "): " + minsToHM(e.minutes));
        if (e.notes.length > 0) lines.push("  Practice notes: " + e.notes.join("; "));
      });
    }
    return lines.join("\n");
  }

  async function send(overrideMsg) {
    var msgText = overrideMsg || input.trim();
    if (!msgText || loading) return;
    if (!overrideMsg) setInput("");
    var newMessages = messages.concat([{role: "user", content: msgText}]);
    setMessages(newMessages);
    setLoading(true);

    try {
      var context = buildContext();
      var systemPrompt = "You are the Conductor — a warm, wise, and slightly witty orchestral audition coach. Think of yourself as a favorite teacher who's been through hundreds of auditions. You're embedded in a musician's audition prep app.\n\n" +
        "Here is the musician's current data:\n\n" + context + "\n\n" +
        "Your personality:\n" +
        "- Warm and encouraging, but honest. You celebrate wins and gently nudge when something needs attention.\n" +
        "- Use occasional musical metaphors and humor (but don't overdo it)\n" +
        "- You might say things like 'Brava!' or 'Let's tune this up' or 'From the top...'\n" +
        "- Be specific — reference their actual excerpts, deadlines, and notes by name\n" +
        "- Keep responses concise (2-3 short paragraphs max) since this is a small chat widget\n\n" +
        "Your expertise:\n" +
        "1. Synthesize their practice notes and give actionable feedback\n" +
        "2. Suggest what to focus on based on deadlines, readiness levels, and practice history\n" +
        "3. Give specific technical tips for excerpts (tempo, style, common pitfalls, what committees listen for)\n" +
        "4. If they haven't practiced something coming up soon, flag it kindly\n" +
        "5. Help with audition nerves, mental preparation, and performance psychology";

      var apiMessages = [{role: "user", content: systemPrompt + "\n\nConversation so far:\n" + newMessages.map(function(m) { return m.role + ": " + m.content; }).join("\n")}];

      if (newMessages.length > 1) {
        apiMessages = [
          {role: "user", content: systemPrompt + "\n\nPlease respond to the conversation below."},
          {role: "assistant", content: "Of course! I'm here and ready to help."}
        ];
        newMessages.forEach(function(m) {
          apiMessages.push({role: m.role === "user" ? "user" : "assistant", content: m.content});
        });
      }

      var resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 800,
          messages: apiMessages
        })
      });
      var data = await resp.json();
      var text = (data.content || []).map(function(b){return b.text || ""}).join("");
      setMessages(function(prev) { return prev.concat([{role: "assistant", content: text}]); });
    } catch(err) {
      console.error("Conductor chat error:", err);
      setMessages(function(prev) { return prev.concat([{role: "assistant", content: "Hmm, I seem to have lost my baton for a moment. Check that your API key is set up and try again!"}]); });
    }
    setLoading(false);
  }

  var quickPrompts = [
    {icon: "🎯", text: "What should I focus on today?"},
    {icon: "📋", text: "Summarize my practice notes"},
    {icon: "🔥", text: "Tips for my most urgent excerpts"},
    {icon: "🧠", text: "Help me with audition nerves"},
  ];

  return (
    <>
      {/* Floating conductor button */}
      <div className="fixed bottom-5 right-5 z-40 flex flex-col items-center gap-1">
        {!open && !loading && (
          <div className="bg-white border border-gray-200 rounded-xl px-3 py-1.5 shadow-md text-xs text-gray-600 animate-bounce mb-1" style={{animationDuration: "2s", animationIterationCount: 3}}>
            Need help? 🎶
          </div>
        )}
        <button
          onClick={function(){setOpen(!open)}}
          className={"rounded-full shadow-lg flex items-center justify-center transition-all duration-300 " + (open ? "w-12 h-12 bg-gray-100 hover:bg-gray-200" : "w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700")}
          title="Talk to the Conductor"
        >
          {open ? (
            <span className="text-gray-500 text-lg">✕</span>
          ) : (
            <ConductorAvatar mood={mood} size={52} />
          )}
        </button>
      </div>

      {/* Chat panel */}
      {open && (
        <div className="fixed inset-0 z-30" onClick={function(){setOpen(false)}} />
      )}
      {open && (
        <div className="fixed bottom-20 right-5 z-40 w-80 sm:w-96 bg-white border border-gray-200 rounded-2xl shadow-2xl flex flex-col" style={{height: 500, maxHeight: "72vh"}} onClick={function(e){e.stopPropagation()}}>
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-3 rounded-t-2xl flex items-center gap-3">
            <div className="bg-white bg-opacity-20 rounded-full p-0.5">
              <ConductorAvatar mood={mood} size={36} />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-sm">The Conductor</div>
              <div className="text-xs text-indigo-200">{loading ? "Composing a response..." : "Your audition coach"}</div>
            </div>
            {messages.length > 0 && (
              <button onClick={function(){setMessages([])}} className="text-indigo-200 hover:text-white text-xs px-2 py-1 rounded hover:bg-white hover:bg-opacity-20 transition-colors" title="Start fresh">
                New chat
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3" style={{minHeight: 0}}>
            {messages.length === 0 && (
              <div className="space-y-3">
                <div className="flex gap-2 items-start">
                  <div className="shrink-0 mt-0.5"><ConductorAvatar mood="happy" size={28} /></div>
                  <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl rounded-tl-sm px-3 py-2 text-sm text-gray-800">
                    <p className="font-medium">{getGreeting()}</p>
                    <p className="text-xs mt-1 text-gray-500">I know your auditions, excerpts, and practice history. Let's make beautiful music! 🎵</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5 px-1">
                  {quickPrompts.map(function(q) {
                    return (
                      <button key={q.text} onClick={function(){send(q.text)}} className="flex items-center gap-1.5 text-left text-xs bg-gray-50 hover:bg-indigo-50 text-gray-600 hover:text-indigo-700 rounded-lg px-2.5 py-2 transition-colors border border-gray-100 hover:border-indigo-200">
                        <span>{q.icon}</span>
                        <span>{q.text}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {messages.map(function(m, i) {
              var isUser = m.role === "user";
              return (
                <div key={i} className={"flex gap-2 " + (isUser ? "justify-end" : "justify-start")}>
                  {!isUser && <div className="shrink-0 mt-0.5"><ConductorAvatar mood="happy" size={24} /></div>}
                  <div className={(isUser ? "bg-indigo-600 text-white rounded-xl rounded-tr-sm" : "bg-gray-50 text-gray-800 border border-gray-100 rounded-xl rounded-tl-sm") + " px-3 py-2 max-w-[80%] text-sm whitespace-pre-wrap"}>
                    {m.content}
                  </div>
                </div>
              );
            })}
            {loading && (
              <div className="flex gap-2 justify-start">
                <div className="shrink-0 mt-0.5"><ConductorAvatar mood="thinking" size={24} /></div>
                <div className="bg-gray-50 border border-gray-100 rounded-xl rounded-tl-sm px-3 py-2 text-sm text-gray-400">
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce" style={{animationDelay: "0ms"}}>♪</span>
                    <span className="animate-bounce" style={{animationDelay: "150ms"}}>♫</span>
                    <span className="animate-bounce" style={{animationDelay: "300ms"}}>♪</span>
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-gray-100 p-3">
            <div className="flex gap-2">
              <input
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
                value={input}
                onChange={function(e){setInput(e.target.value)}}
                onKeyDown={function(e){if(e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }}}
                placeholder="Ask me anything..."
                disabled={loading}
              />
              <button
                onClick={function(){send()}}
                disabled={loading || !input.trim()}
                className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white w-10 h-10 rounded-xl flex items-center justify-center text-sm font-medium hover:from-indigo-700 hover:to-purple-700 transition-colors disabled:opacity-40"
              >
                ↑
              </button>
            </div>
            {!API_KEY && (
              <p className="text-xs text-red-400 mt-1.5 text-center">Set VITE_ANTHROPIC_API_KEY to enable the Conductor.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

var REFLECTION_FIELDS = [
  {key: "wentWell", label: "What went well", icon: "✅", placeholder: "What did you nail? What felt strong?"},
  {key: "didntGoWell", label: "What didn't go well", icon: "🔻", placeholder: "What fell apart or felt shaky?"},
  {key: "onStage", label: "How I felt on stage", icon: "🎭", placeholder: "Nerves? Confidence? Focus? Energy level?"},
  {key: "thatMorning", label: "What I did that morning", icon: "🌅", placeholder: "Warm-up routine, food, travel, timing..."},
  {key: "sleepNightBefore", label: "How I slept the night before", icon: "🌙", placeholder: "Hours, quality, anything that helped or hurt..."},
  {key: "dayBefore", label: "What I did the day before", icon: "📅", placeholder: "Practice, rest, travel, social, mental prep..."},
  {key: "generalNotes", label: "General notes", icon: "📝", placeholder: "Anything else worth remembering for next time..."},
];

function ReflectionsTab(props) {
  var auditions = props.auditions;
  var reflections = props.reflections;
  var onSave = props.onSave;

  var completed = auditions.filter(function(a) {
    return ["Auditioned","Advanced","Won","Didn't Advance","Withdrew"].indexOf(a.status) >= 0;
  });
  var upcoming = auditions.filter(function(a) {
    return ["Preparing","Applied","Scheduled"].indexOf(a.status) >= 0;
  });

  var [selectedId, setSelectedId] = useState(null);
  var [editing, setEditing] = useState(null);

  function startReflection(auditionId) {
    var existing = reflections[auditionId] || {};
    setSelectedId(auditionId);
    var draft = {};
    REFLECTION_FIELDS.forEach(function(f) {
      draft[f.key] = existing[f.key] || "";
    });
    setEditing(draft);
  }

  function updateField(key, value) {
    setEditing(function(prev) { return {...prev, [key]: value}; });
  }

  function save() {
    if (!selectedId || !editing) return;
    onSave(selectedId, editing);
    setSelectedId(null);
    setEditing(null);
  }

  function cancel() {
    setSelectedId(null);
    setEditing(null);
  }

  function hasReflection(id) {
    var r = reflections[id];
    if (!r) return false;
    return REFLECTION_FIELDS.some(function(f) { return r[f.key] && r[f.key].trim(); });
  }

  function filledCount(id) {
    var r = reflections[id];
    if (!r) return 0;
    return REFLECTION_FIELDS.filter(function(f) { return r[f.key] && r[f.key].trim(); }).length;
  }

  if (selectedId && editing) {
    var aud = auditions.find(function(a) { return a.id === selectedId; });
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">{aud ? aud.orchestra : "Audition"}</h3>
            <p className="text-xs text-gray-400">{aud ? fmtDate(aud.date) : ""}{aud && aud.round ? " · " + aud.round : ""}</p>
          </div>
          <Btn variant="ghost" onClick={cancel} className="text-xs">← Back</Btn>
        </div>
        <div className="space-y-3">
          {REFLECTION_FIELDS.map(function(f) {
            return (
              <div key={f.key} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                  <span className="text-sm font-medium text-gray-700">{f.icon} {f.label}</span>
                </div>
                <textarea
                  className="w-full px-4 py-3 text-sm text-gray-800 focus:outline-none resize-none leading-relaxed"
                  rows={3}
                  value={editing[f.key]}
                  onChange={function(e){updateField(f.key, e.target.value)}}
                  placeholder={f.placeholder}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-2 justify-end">
          <Btn variant="secondary" onClick={cancel}>Cancel</Btn>
          <Btn onClick={save}>Save Reflection</Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-center py-2">
        <p className="text-sm text-gray-500">Reflect on past auditions to learn and improve.</p>
      </div>

      {completed.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-700">Completed Auditions</h4>
          {completed.map(function(a) {
            var has = hasReflection(a.id);
            var filled = filledCount(a.id);
            return (
              <div key={a.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium text-gray-900">{a.orchestra} <span className="text-sm font-normal text-gray-400">({getShortName(a)})</span></h3>
                    <p className="text-xs text-gray-400 mt-0.5">{fmtDate(a.date)}{a.round ? " · " + a.round : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge status={a.status} />
                  </div>
                </div>
                {has && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                      <div className="bg-indigo-500 h-1.5 rounded-full transition-all" style={{width: Math.round((filled / REFLECTION_FIELDS.length) * 100) + "%"}} />
                    </div>
                    <span className="text-xs text-gray-400">{filled}/{REFLECTION_FIELDS.length}</span>
                  </div>
                )}
                {has && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {REFLECTION_FIELDS.filter(function(f) { return reflections[a.id] && reflections[a.id][f.key] && reflections[a.id][f.key].trim(); }).map(function(f) {
                      return <span key={f.key} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{f.icon} {f.label}</span>;
                    })}
                  </div>
                )}
                <div className="mt-3">
                  <Btn variant={has ? "secondary" : "primary"} className="text-xs" onClick={function(){startReflection(a.id)}}>
                    {has ? "Edit Reflection" : "Write Reflection"}
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-400">Upcoming — reflect after the audition</h4>
          {upcoming.map(function(a) {
            return (
              <div key={a.id} className="bg-gray-50 border border-gray-100 rounded-xl p-3 flex items-center justify-between opacity-60">
                <div>
                  <span className="text-sm text-gray-500">{a.orchestra}</span>
                  <span className="text-xs text-gray-400 ml-2">{fmtDate(a.date)}</span>
                </div>
                <Badge status={a.status} />
              </div>
            );
          })}
        </div>
      )}

      {completed.length === 0 && upcoming.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">No auditions yet. Reflections will appear here after you've auditioned.</p>
      )}
    </div>
  );
}

var INSTRUMENTS = [
  "Violin","Viola","Cello","Double Bass",
  "Flute","Oboe","Clarinet","Bassoon",
  "French Horn","Trumpet","Trombone","Bass Trombone","Tuba",
  "Percussion","Timpani","Harp","Piano","Other"
];

var COMPOSER_AVATARS = [
  { id: "beethoven", name: "Beethoven", hair: "#5c4033", hairStyle: "wild", skin: "#fcd34d", accent: "#1e1b4b", feature: "scowl" },
  { id: "mozart", name: "Mozart", hair: "#f5f5dc", hairStyle: "powdered", skin: "#fcd34d", accent: "#ec4899", feature: "cheerful" },
  { id: "bach", name: "Bach", hair: "#d4d4d4", hairStyle: "baroque", skin: "#fcd34d", accent: "#1e1b4b", feature: "wise" },
  { id: "brahms", name: "Brahms", hair: "#8b6914", hairStyle: "bushy", skin: "#fcd34d", accent: "#78350f", feature: "beard" },
  { id: "tchaikovsky", name: "Tchaikovsky", hair: "#6b7280", hairStyle: "neat", skin: "#fcd34d", accent: "#1e40af", feature: "moustache" },
  { id: "mahler", name: "Mahler", hair: "#1f2937", hairStyle: "parted", skin: "#fcd34d", accent: "#1e1b4b", feature: "glasses" },
  { id: "debussy", name: "Debussy", hair: "#1f2937", hairStyle: "wavy", skin: "#fcd34d", accent: "#6366f1", feature: "dreamy" },
  { id: "dvorak", name: "Dvořák", hair: "#78350f", hairStyle: "curly", skin: "#fcd34d", accent: "#15803d", feature: "beard" },
  { id: "shostakovich", name: "Shostakovich", hair: "#1f2937", hairStyle: "short", skin: "#fcd34d", accent: "#dc2626", feature: "glasses" },
  { id: "stravinsky", name: "Stravinsky", hair: "#9ca3af", hairStyle: "bald", skin: "#fcd34d", accent: "#f59e0b", feature: "sharp" },
  { id: "clara", name: "Clara Schumann", hair: "#5c4033", hairStyle: "updo", skin: "#fcd34d", accent: "#7c3aed", feature: "elegant" },
  { id: "hildegard", name: "Hildegard", hair: "#f5f5dc", hairStyle: "veil", skin: "#fcd34d", accent: "#0ea5e9", feature: "serene" },
];

function ComposerAvatarSVG(props) {
  var c = props.composer;
  var size = props.size || 64;
  if (!c) return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="45" fill="#e0e7ff" />
      <text x="50" y="58" textAnchor="middle" fontSize="30">🎵</text>
    </svg>
  );

  var hairPaths = {
    wild: <><path d="M20 45 Q15 20 35 15 Q45 5 55 10 Q70 5 80 20 Q90 35 80 45" fill={c.hair} /><path d="M22 40 Q18 25 30 18" stroke={c.hair} strokeWidth="4" fill="none" /><path d="M78 40 Q82 25 70 18" stroke={c.hair} strokeWidth="4" fill="none" /></>,
    powdered: <><ellipse cx="50" cy="30" rx="30" ry="20" fill={c.hair} /><circle cx="25" cy="40" r="8" fill={c.hair} /><circle cx="75" cy="40" r="8" fill={c.hair} /><path d="M30 15 Q50 5 70 15" fill={c.hair} /></>,
    baroque: <><path d="M18 50 Q15 15 50 12 Q85 15 82 50" fill={c.hair} /><ellipse cx="22" cy="48" rx="8" ry="12" fill={c.hair} /><ellipse cx="78" cy="48" rx="8" ry="12" fill={c.hair} /></>,
    bushy: <><path d="M20 45 Q18 20 50 15 Q82 20 80 45" fill={c.hair} /><ellipse cx="20" cy="55" rx="6" ry="10" fill={c.hair} /><ellipse cx="80" cy="55" rx="6" ry="10" fill={c.hair} /></>,
    neat: <><path d="M22 45 Q20 22 50 18 Q80 22 78 45" fill={c.hair} /></>,
    parted: <><path d="M22 45 Q20 20 48 15 L50 15 Q80 20 78 45" fill={c.hair} /><line x1="48" y1="15" x2="45" y2="30" stroke="#111" strokeWidth="1" opacity="0.3" /></>,
    wavy: <><path d="M20 48 Q15 20 50 14 Q85 20 80 48" fill={c.hair} /><path d="M25 35 Q30 25 35 35 Q40 25 45 35" stroke={c.hair} strokeWidth="3" fill="none" /></>,
    curly: <><path d="M20 45 Q18 18 50 13 Q82 18 80 45" fill={c.hair} /><circle cx="28" cy="22" r="5" fill={c.hair} /><circle cx="42" cy="16" r="5" fill={c.hair} /><circle cx="58" cy="16" r="5" fill={c.hair} /><circle cx="72" cy="22" r="5" fill={c.hair} /></>,
    short: <><path d="M25 42 Q23 25 50 20 Q77 25 75 42" fill={c.hair} /></>,
    bald: <><path d="M30 40 Q28 32 50 28 Q72 32 70 40" fill={c.hair} /></>,
    updo: <><path d="M25 45 Q22 20 50 15 Q78 20 75 45" fill={c.hair} /><ellipse cx="50" cy="12" rx="15" ry="10" fill={c.hair} /><circle cx="55" cy="8" r="3" fill={c.accent} /></>,
    veil: <><path d="M18 55 Q15 15 50 10 Q85 15 82 55" fill="#e0e7ff" /><path d="M25 45 Q22 22 50 17 Q78 22 75 45" fill={c.hair} /></>,
  };

  var features = {
    scowl: <><text x="38" y="56" textAnchor="middle" fontSize="8" fill={c.accent}>▼</text><text x="62" y="56" textAnchor="middle" fontSize="8" fill={c.accent}>▼</text><path d="M38 66 Q50 62 62 66" stroke={c.accent} strokeWidth="2" fill="none" /></>,
    cheerful: <><circle cx="38" cy="53" r="3" fill={c.accent} /><circle cx="62" cy="53" r="3" fill={c.accent} /><path d="M38 66 Q50 74 62 66" stroke={c.accent} strokeWidth="2" fill="none" /><circle cx="36" cy="60" r="4" fill="#fca5a5" opacity="0.5" /><circle cx="64" cy="60" r="4" fill="#fca5a5" opacity="0.5" /></>,
    wise: <><circle cx="38" cy="53" r="3" fill={c.accent} /><circle cx="62" cy="53" r="3" fill={c.accent} /><path d="M40 67 Q50 70 60 67" stroke={c.accent} strokeWidth="1.5" fill="none" /></>,
    beard: <><circle cx="38" cy="53" r="3" fill={c.accent} /><circle cx="62" cy="53" r="3" fill={c.accent} /><path d="M35 65 Q50 68 65 65" stroke={c.accent} strokeWidth="1.5" fill="none" /><path d="M32 68 Q50 90 68 68" fill={c.hair} opacity="0.7" /></>,
    moustache: <><circle cx="38" cy="53" r="3" fill={c.accent} /><circle cx="62" cy="53" r="3" fill={c.accent} /><path d="M38 64 Q50 60 62 64" stroke={c.hair} strokeWidth="3" fill="none" /><path d="M42 68 Q50 72 58 68" stroke={c.accent} strokeWidth="1.5" fill="none" /></>,
    glasses: <><circle cx="38" cy="53" r="7" stroke={c.accent} strokeWidth="2" fill="none" /><circle cx="62" cy="53" r="7" stroke={c.accent} strokeWidth="2" fill="none" /><line x1="45" y1="53" x2="55" y2="53" stroke={c.accent} strokeWidth="2" /><circle cx="38" cy="53" r="2.5" fill={c.accent} /><circle cx="62" cy="53" r="2.5" fill={c.accent} /><path d="M40 68 Q50 72 60 68" stroke={c.accent} strokeWidth="1.5" fill="none" /></>,
    dreamy: <><ellipse cx="38" cy="53" rx="4" ry="3" fill={c.accent} /><ellipse cx="62" cy="53" rx="4" ry="3" fill={c.accent} /><path d="M40 67 Q50 72 60 67" stroke={c.accent} strokeWidth="1.5" fill="none" /><circle cx="34" cy="59" r="4" fill="#c4b5fd" opacity="0.4" /><circle cx="66" cy="59" r="4" fill="#c4b5fd" opacity="0.4" /></>,
    sharp: <><line x1="33" y1="50" x2="43" y2="50" stroke={c.accent} strokeWidth="2" /><line x1="57" y1="50" x2="67" y2="50" stroke={c.accent} strokeWidth="2" /><circle cx="38" cy="55" r="2.5" fill={c.accent} /><circle cx="62" cy="55" r="2.5" fill={c.accent} /><path d="M42 67 Q50 70 58 67" stroke={c.accent} strokeWidth="1.5" fill="none" /></>,
    elegant: <><ellipse cx="38" cy="53" rx="3" ry="3.5" fill={c.accent} /><ellipse cx="62" cy="53" rx="3" ry="3.5" fill={c.accent} /><path d="M40 66 Q50 72 60 66" stroke={c.accent} strokeWidth="1.5" fill="none" /><circle cx="35" cy="59" r="4" fill="#fca5a5" opacity="0.4" /><circle cx="65" cy="59" r="4" fill="#fca5a5" opacity="0.4" /></>,
    serene: <><path d="M35 53 Q38 51 41 53" stroke={c.accent} strokeWidth="2" fill="none" /><path d="M59 53 Q62 51 65 53" stroke={c.accent} strokeWidth="2" fill="none" /><path d="M42 67 Q50 71 58 67" stroke={c.accent} strokeWidth="1.5" fill="none" /></>,
  };

  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" fill="#f0f0ff" />
      {/* Hair behind */}
      {hairPaths[c.hairStyle]}
      {/* Face */}
      <ellipse cx="50" cy="55" rx="25" ry="27" fill={c.skin} />
      {/* Cheeks default */}
      {/* Features (eyes, mouth, extras) */}
      {features[c.feature]}
      {/* Collar */}
      <path d="M35 80 Q50 85 65 80 L70 95 Q50 90 30 95 Z" fill={c.accent} opacity="0.3" />
    </svg>
  );
}

function ProfileTab(props) {
  var profile = props.profile;
  var onSave = props.onSave;

  var [f, setF] = useState({
    firstName: (profile && profile.firstName) || "",
    lastName: (profile && profile.lastName) || "",
    instrument: (profile && profile.instrument) || "",
    birthday: (profile && profile.birthday) || "",
    bio: (profile && profile.bio) || "",
    teacher: (profile && profile.teacher) || "",
    currentEnsemble: (profile && profile.currentEnsemble) || "",
    yearsPlaying: (profile && profile.yearsPlaying) || "",
    avatarId: (profile && profile.avatarId) || "",
  });
  var [saved, setSaved] = useState(false);
  var [showAvatarPicker, setShowAvatarPicker] = useState(false);

  function update(key, val) {
    setF(function(prev) { return {...prev, [key]: val}; });
    setSaved(false);
  }

  function save() {
    onSave(f);
    setSaved(true);
    setTimeout(function() { setSaved(false); }, 2000);
  }

  var selectedComposer = COMPOSER_AVATARS.find(function(c) { return c.id === f.avatarId; }) || null;

  return (
    <div className="space-y-5">
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={function(){setShowAvatarPicker(!showAvatarPicker)}} className="shrink-0 group relative" title="Change avatar">
            <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-indigo-200 group-hover:border-indigo-400 transition-colors">
              {selectedComposer ? (
                <ComposerAvatarSVG composer={selectedComposer} size={64} />
              ) : (
                <div className="w-full h-full bg-indigo-100 flex items-center justify-center text-2xl">
                  {f.firstName ? f.firstName[0].toUpperCase() : "🎵"}
                </div>
              )}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs border-2 border-white">✎</div>
          </button>
          <div>
            <h3 className="font-semibold text-gray-800">Your Profile</h3>
            <p className="text-xs text-gray-400">{selectedComposer ? "Avatar: " + selectedComposer.name : "Click the icon to choose an avatar!"}</p>
          </div>
        </div>

        {showAvatarPicker && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-700">Choose Your Composer</h4>
              <button onClick={function(){setShowAvatarPicker(false)}} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
              {COMPOSER_AVATARS.map(function(c) {
                var isSelected = f.avatarId === c.id;
                return (
                  <button key={c.id} onClick={function(){update("avatarId", c.id); setShowAvatarPicker(false)}} className={"flex flex-col items-center gap-1 p-2 rounded-xl transition-all " + (isSelected ? "bg-indigo-100 border-2 border-indigo-400 scale-105" : "hover:bg-gray-100 border-2 border-transparent")}>
                    <ComposerAvatarSVG composer={c} size={48} />
                    <span className="text-xs text-gray-600 leading-tight text-center">{c.name}</span>
                  </button>
                );
              })}
            </div>
            {f.avatarId && (
              <button onClick={function(){update("avatarId", "")}} className="text-xs text-gray-400 hover:text-red-500">Remove avatar</button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Inp label="First Name" value={f.firstName} onChange={function(e){update("firstName", e.target.value)}} placeholder="Natalie" />
          <Inp label="Last Name" value={f.lastName} onChange={function(e){update("lastName", e.target.value)}} placeholder="Smith" />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Instrument</label>
            <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" value={f.instrument} onChange={function(e){update("instrument", e.target.value)}}>
              <option value="">Select...</option>
              {INSTRUMENTS.map(function(inst) { return <option key={inst} value={inst}>{inst}</option>; })}
            </select>
          </div>
          <Inp label="Birthday" type="date" value={f.birthday} onChange={function(e){update("birthday", e.target.value)}} />
          <Inp label="Teacher / Mentor" value={f.teacher} onChange={function(e){update("teacher", e.target.value)}} placeholder="Prof. Johnson" />
          <Inp label="Current Ensemble" value={f.currentEnsemble} onChange={function(e){update("currentEnsemble", e.target.value)}} placeholder="City Symphony" />
          <Inp label="Years Playing" type="number" value={f.yearsPlaying} onChange={function(e){update("yearsPlaying", e.target.value)}} placeholder="12" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">About / Goals</label>
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none leading-relaxed"
            rows={3}
            value={f.bio}
            onChange={function(e){update("bio", e.target.value)}}
            placeholder="Your musical goals, what you're working toward..."
          />
        </div>
        <div className="flex items-center gap-3">
          <Btn onClick={save}>Save Profile</Btn>
          {saved && <span className="text-sm text-green-600 font-medium">Saved!</span>}
        </div>
      </div>
    </div>
  );
}

function exportCSV(data) {
  var rows = [["Orchestra","Short Name","Date","Location","Status","Round","Notes","Excerpts"]];
  data.auditions.forEach(function(a) {
    var ex = (a.excerpts || []).map(function(e){return e.structured ? e.piece+"|"+e.movement+"|"+e.measures : e.freeText}).join("; ");
    rows.push([a.orchestra, getShortName(a), a.date, a.location, a.status, a.round, a.notes, ex]);
  });
  var csv = rows.map(function(r){return r.map(function(c){return '"' + (c||"").replace(/"/g,'""') + '"'}).join(",")}).join("\n");
  var blob = new Blob([csv], {type:"text/csv"});
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = "auditions.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export default function App(props) {
  var session = props.session;
  var userId = session.user.id;

  var [data, setData] = useState(makeDefault());
  var [tab, setTab] = useState("auditions");
  var [editing, setEditing] = useState(null);
  var [loading, setLoading] = useState(true);
  var [conductorMessages, setConductorMessages] = useState([]);

  var QUOTES = [
    "I'm not a genius. I'm just a tremendous bundle of experience. — R. Buckminster Fuller",
    "Simplicity is the final achievement. — Frédéric Chopin",
    "Music is enough for a lifetime, but a lifetime is not enough for music. — Sergei Rachmaninoff",
    "The music is not in the notes, but in the silence between. — Wolfgang Amadeus Mozart",
    "Without craftsmanship, inspiration is a mere reed shaken in the wind. — Johannes Brahms",
    "I never practice; I always play. — Wanda Landowska",
    "To play a wrong note is insignificant; to play without passion is inexcusable. — Ludwig van Beethoven",
    "There are no mistakes, only opportunities. — Tina Fey",
    "I was obliged to be industrious. Whoever is equally industrious will succeed equally well. — J.S. Bach",
    "You have to practice to be the person you want to be on stage. — Renée Fleming",
    "The most perfect technique is that which is not noticed at all. — Pablo Casals",
    "If I don't practice one day, I know it; two days, the critics know it; three days, the public knows it. — Jascha Heifetz",
    "I tell my students, 'You have to love to practice, or practice to love.' — Itzhak Perlman",
    "Music can change the world because it can change people. — Bono",
    "An artist must be free to choose what he does, certainly, but he must also never be afraid to do what he might choose. — Langston Hughes",
    "Where there is devotion, there is always great music. — Nadia Boulanger",
    "Do not fear mistakes. There are none. — Miles Davis",
    "Art is not what you see, but what you make others see. — Edgar Degas",
    "Every day do something that will inch you closer to a better tomorrow. — Doug Firebaugh",
    "You can't just play a piece. You have to become the piece. — Jacqueline du Pré",
    "The only way to do it is to do it. — Merce Cunningham",
    "Music is your own experience, your thoughts, your wisdom. — Charlie Parker",
    "Study the masters. And then leave them behind. — Gustav Mahler",
    "Great moments are born from great opportunity. — Herb Brooks",
    "I am not afraid of storms, for I am learning how to sail my ship. — Louisa May Alcott",
  ];
  var dailyQuote = useMemo(function() {
    return QUOTES[Math.floor(Math.random() * QUOTES.length)];
  }, []);

  // Load all data from Supabase on mount, migrate localStorage if needed
  useEffect(function() {
    var cancelled = false;
    async function load() {
      try {
        var [auditions, practiceLog, readiness, settings] = await Promise.all([
          fetchAuditions(),
          fetchPracticeLog(),
          fetchReadiness(),
          fetchSettings(),
        ]);

        // Auto-migrate from localStorage if Supabase is empty and localStorage has data
        var localRaw = null;
        try { localRaw = localStorage.getItem(SK); } catch(e) {}
        var localData = localRaw ? JSON.parse(localRaw) : null;

        if (auditions.length === 0 && localData && localData.auditions && localData.auditions.length > 0) {
          console.log("Migrating localStorage data to Supabase...");
          // Migrate auditions
          for (var i = 0; i < localData.auditions.length; i++) {
            var a = localData.auditions[i];
            if (!a.shortName) a.shortName = a.shortName || autoAbbrev(a.orchestra);
            await upsertAudition(userId, a);
          }
          // Migrate practice log
          if (localData.practiceLog) {
            for (var j = 0; j < localData.practiceLog.length; j++) {
              await insertPractice(userId, localData.practiceLog[j]);
            }
          }
          // Migrate readiness
          if (localData.readiness) {
            var keys = Object.keys(localData.readiness);
            for (var k = 0; k < keys.length; k++) {
              await upsertReadiness(userId, keys[k], localData.readiness[keys[k]]);
            }
          }
          // Migrate settings
          if (localData.settings) {
            await upsertSettings(userId, localData.settings);
          }
          // Mark migration done so we don't repeat
          try { localStorage.setItem(SK + "-migrated", "true"); } catch(e) {}
          console.log("Migration complete!");

          // Re-fetch everything from Supabase
          var fresh = await Promise.all([
            fetchAuditions(),
            fetchPracticeLog(),
            fetchReadiness(),
            fetchSettings(),
          ]);
          auditions = fresh[0];
          practiceLog = fresh[1];
          readiness = fresh[2];
          settings = fresh[3];
        }

        if (!cancelled) {
          setData({
            auditions: auditions,
            practiceLog: practiceLog,
            readiness: readiness,
            settings: settings || JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
          });
          setLoading(false);
        }
      } catch(err) {
        console.error("Failed to load data:", err);
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function() { cancelled = true; };
  }, []);

  async function saveAudition(a) {
    try {
      await upsertAudition(userId, a);
      var idx = data.auditions.findIndex(function(x){return x.id === a.id});
      var au = idx >= 0 ? data.auditions.map(function(x,i){return i === idx ? a : x}) : [...data.auditions, a];
      setData(function(prev) { return {...prev, auditions: au}; });
      setEditing(null);
    } catch(err) {
      console.error("Save audition error:", err);
      alert("Failed to save audition. Check console.");
    }
  }

  async function deleteAudition(id) {
    try {
      await deleteAuditionDB(id);
      // also delete related practice logs from DB
      var relatedLogs = data.practiceLog.filter(function(p){return p.auditionId === id});
      for (var i = 0; i < relatedLogs.length; i++) {
        await deletePracticeDB(relatedLogs[i].id);
      }
      setData(function(prev) {
        return {
          ...prev,
          auditions: prev.auditions.filter(function(a){return a.id !== id}),
          practiceLog: prev.practiceLog.filter(function(p){return p.auditionId !== id}),
        };
      });
    } catch(err) {
      console.error("Delete audition error:", err);
    }
  }

  async function addPractice(entry) {
    try {
      await insertPractice(userId, entry);
      setData(function(prev) { return {...prev, practiceLog: [entry, ...prev.practiceLog]}; });
    } catch(err) {
      console.error("Add practice error:", err);
    }
  }

  async function deletePractice(id) {
    try {
      await deletePracticeDB(id);
      setData(function(prev) { return {...prev, practiceLog: prev.practiceLog.filter(function(p){return p.id !== id})}; });
    } catch(err) {
      console.error("Delete practice error:", err);
    }
  }

  async function setReadinessLevel(key, level) {
    try {
      await upsertReadiness(userId, key, level);
      setData(function(prev) { return {...prev, readiness: {...(prev.readiness || {}), [key]: level}}; });
    } catch(err) {
      console.error("Set readiness error:", err);
    }
  }

  async function updateSettings(s) {
    try {
      await upsertSettings(userId, s);
      setData(function(prev) { return {...prev, settings: s}; });
    } catch(err) {
      console.error("Update settings error:", err);
    }
  }

  async function saveReflection(auditionId, reflection) {
    var s = data.settings || DEFAULT_SETTINGS;
    var updated = {...s, reflections: {...(s.reflections || {}), [auditionId]: reflection}};
    await updateSettings(updated);
  }

  async function saveMilestoneNote(key, noteText) {
    var s = data.settings || DEFAULT_SETTINGS;
    var updated = {...s, milestoneNotes: {...(s.milestoneNotes || {}), [key]: noteText}};
    await updateSettings(updated);
  }

  async function toggleMilestoneComplete(key, completed) {
    var s = data.settings || DEFAULT_SETTINGS;
    var updated = {...s, milestoneComplete: {...(s.milestoneComplete || {}), [key]: completed}};
    await updateSettings(updated);
  }

  async function saveProfile(profile) {
    var s = data.settings || DEFAULT_SETTINGS;
    var updated = {...s, profile: profile};
    await updateSettings(updated);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  var settings = data.settings || DEFAULT_SETTINGS;

  var stats = useMemo(function() {
    var t = data.auditions.length;
    var w = data.auditions.filter(function(a){return a.status === "Won"}).length;
    var adv = data.auditions.filter(function(a){return a.status === "Advanced"}).length;
    var comp = data.auditions.filter(function(a){return ["Auditioned","Advanced","Won","Didn't Advance"].indexOf(a.status) >= 0}).length;
    var tp = data.practiceLog.reduce(function(s,p){return s + p.minutes}, 0);
    return {total:t, won:w, advanced:adv, completed:comp, totalPractice:tp, advanceRate: comp > 0 ? Math.round(((w+adv)/comp)*100) : 0};
  }, [data]);

  var sorted = useMemo(function() {
    return [...data.auditions].sort(function(a,b) {
      return (a.date ? new Date(a.date) : new Date("2099-01-01")) - (b.date ? new Date(b.date) : new Date("2099-01-01"));
    });
  }, [data.auditions]);

  var hasActiveMilestones = useMemo(function() {
    var active = data.auditions.filter(function(a){return ["Preparing","Applied","Scheduled"].indexOf(a.status) >= 0 && a.date});
    var miles = (settings.runThroughMilestones || []);
    return active.some(function(a) {
      var d = daysUntil(a.date);
      return miles.some(function(m){return d <= m.daysOut && d > 0});
    });
  }, [data.auditions, settings]);

  var [remindersDismissed, setRemindersDismissed] = useState(false);

  var urgentMilestones = useMemo(function() {
    if (loading) return [];
    var active = data.auditions.filter(function(a){return ["Preparing","Applied","Scheduled"].indexOf(a.status) >= 0 && a.date});
    var miles = settings.runThroughMilestones || DEFAULT_SETTINGS.runThroughMilestones;
    var mc = (data.settings || {}).milestoneComplete || {};
    var urgent = [];
    active.forEach(function(a) {
      miles.forEach(function(m) {
        var mKey = a.id + "::" + m.label;
        if (mc[mKey]) return;
        var targetDate = new Date(a.date + "T12:00:00");
        targetDate.setDate(targetDate.getDate() - m.daysOut);
        var daysLeft = daysUntil(localDateStr(targetDate));
        if (daysLeft >= -1 && daysLeft <= 3) {
          urgent.push({
            label: m.label,
            orchestra: getShortName(a),
            daysLeft: daysLeft,
            type: m.type,
          });
        }
      });
    });
    urgent.sort(function(a, b) { return a.daysLeft - b.daysLeft; });
    return urgent;
  }, [data.auditions, settings, data.settings, loading]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-4 text-center py-20">
        <p className="text-gray-400 text-sm">Loading your data...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4 font-sans">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          {(function() {
            var avatarId = settings.profile && settings.profile.avatarId;
            var comp = avatarId && COMPOSER_AVATARS.find(function(c) { return c.id === avatarId; });
            if (comp) return <ComposerAvatarSVG composer={comp} size={32} />;
            return <ConductorAvatar mood="happy" size={32} />;
          })()}
          <span>{(function() {
            var profile = settings.profile;
            var name = profile && profile.firstName;
            var isBirthday = false;
            if (profile && profile.birthday) {
              var today = new Date();
              var bday = new Date(profile.birthday + "T12:00:00");
              isBirthday = today.getMonth() === bday.getMonth() && today.getDate() === bday.getDate();
            }
            if (name && isBirthday) return "Happy Birthday, " + name + "! 🎂";
            if (name) return "Hi, " + name + "!";
            return "Audition Tracker";
          })()}</span>
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 hidden sm:inline">{session.user.email}</span>
          <Btn variant="ghost" onClick={function(){exportCSV(data)}} className="text-xs">Export CSV</Btn>
          <Btn variant="ghost" onClick={handleSignOut} className="text-xs">Sign Out</Btn>
        </div>
      </div>
      <p className="text-xs text-gray-400 italic -mt-2">{dailyQuote}</p>
      {urgentMilestones.length > 0 && !remindersDismissed && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ConductorAvatar mood="happy" size={24} />
              <span className="text-sm font-semibold text-amber-800">Milestone Reminder!</span>
            </div>
            <button onClick={function(){setRemindersDismissed(true)}} className="text-amber-400 hover:text-amber-600 text-sm">✕</button>
          </div>
          {urgentMilestones.map(function(m, i) {
            return (
              <div key={i} className="flex items-center gap-2 text-sm text-amber-800">
                <span className={"font-bold " + (m.daysLeft <= 0 ? "text-red-600" : m.daysLeft === 1 ? "text-red-500" : "text-amber-600")}>
                  {m.daysLeft < 0 ? "Overdue!" : m.daysLeft === 0 ? "Today!" : m.daysLeft === 1 ? "Tomorrow!" : m.daysLeft + " days left"}
                </span>
                <span>—</span>
                <span>{m.label}</span>
                <span className="text-amber-500">({m.orchestra})</span>
              </div>
            );
          })}
          <button onClick={function(){setTab("milestones"); setRemindersDismissed(true)}} className="text-xs text-amber-700 hover:text-amber-900 font-medium">
            Go to Milestones →
          </button>
        </div>
      )}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {[["auditions","Auditions"],["planner","Prep Planner"],["practice","Practice"],["milestones","Milestones"],["reflections","Reflections"],["profile","Profile"],["settings","Settings"]].map(function(item) {
          return (
            <TabBtn key={item[0]} label={item[1]} active={tab === item[0]} onClick={function(){setTab(item[0])}} alert={(item[0] === "planner" || item[0] === "milestones") && hasActiveMilestones} />
          );
        })}
      </div>

      {tab === "auditions" && (
        <div className="space-y-4">
          {editing ? (
            <AuditionForm
              initial={editing === "new" ? null : data.auditions.find(function(a){return a.id === editing})}
              onSave={saveAudition}
              onCancel={function(){setEditing(null)}}
            />
          ) : (
            <Btn onClick={function(){setEditing("new")}}>+ New Audition</Btn>
          )}
          {sorted.length === 0 && !editing && (<p className="text-sm text-gray-400 text-center py-8">No auditions yet — add one to get started.</p>)}
          {sorted.map(function(a) {
            var d = daysUntil(a.date);
            return (
              <div key={a.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-2 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{a.orchestra} <span className="text-sm font-normal text-gray-400">({getShortName(a)})</span></h3>
                    <p className="text-sm text-gray-500">
                      {fmtDate(a.date)}{a.location ? " · " + a.location : ""}{a.round ? " · " + a.round : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge status={a.status} />
                    {a.date && d > 0 && d < 999 && (
                      <span className={"text-xs " + (d <= 7 ? "text-red-600 font-bold" : "text-gray-400")}>{d}d</span>
                    )}
                  </div>
                </div>
                {a.excerpts.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {a.excerpts.map(function(e) {
                      return (<span key={e.id} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{excLabel(e)}</span>);
                    })}
                  </div>
                )}
                {a.notes && (<p className="text-sm text-gray-500 italic">{a.notes}</p>)}
                <div className="flex gap-2 pt-1">
                  <Btn variant="ghost" className="text-xs" onClick={function(){setEditing(a.id)}}>Edit</Btn>
                  <Btn variant="danger" className="text-xs" onClick={function(){deleteAudition(a.id)}}>Delete</Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "planner" && (
        <PrepPlanner auditions={data.auditions} readiness={data.readiness || {}} onSetReadiness={setReadinessLevel} practiceLog={data.practiceLog} settings={settings} onSwitchTab={setTab} />
      )}

      {tab === "milestones" && (
        <MilestonesTab auditions={data.auditions} settings={settings} milestoneNotes={(data.settings || {}).milestoneNotes || {}} milestoneComplete={(data.settings || {}).milestoneComplete || {}} onSaveNote={saveMilestoneNote} onToggleComplete={toggleMilestoneComplete} />
      )}

      {tab === "practice" && (
        <PracticeTab auditions={data.auditions} practiceLog={data.practiceLog} onAdd={addPractice} onDelete={deletePractice} settings={settings} />
      )}

      {tab === "reflections" && (
        <ReflectionsTab auditions={data.auditions} reflections={(data.settings || {}).reflections || {}} onSave={saveReflection} />
      )}

      {tab === "profile" && (
        <ProfileTab profile={(data.settings || {}).profile || {}} onSave={saveProfile} />
      )}

      {tab === "settings" && (
        <SettingsPanel settings={settings} onUpdate={updateSettings} />
      )}

      {(tab === "practice" || tab === "planner" || tab === "milestones") && (
        <ConductorChat auditions={data.auditions} practiceLog={data.practiceLog} readiness={data.readiness || {}} messages={conductorMessages} onSetMessages={setConductorMessages} />
      )}
    </div>
  );
}
