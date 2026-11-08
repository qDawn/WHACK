import type { ReactNode } from "react";

type SketchFamily = "browser" | "editor" | "chat" | "terminal" | "godot" | "generic";

const BROWSER_KINDS = new Set(["open_chrome", "open_edge", "open_firefox", "open_url"]);
const EDITOR_KINDS = new Set(["open_vscode", "open_cursor"]);
const CHAT_KINDS = new Set([
  "focus_discord",
  "open_slack",
  "open_teams",
  "open_whatsapp",
  "open_telegram",
]);
const TERMINAL_KINDS = new Set(["open_terminal", "open_powershell", "open_command"]);

type SuggestionsPreviewProps = {
  kind: string;
  title: string;
};

function sketchFamily(kind: string): SketchFamily {
  if (BROWSER_KINDS.has(kind)) return "browser";
  if (EDITOR_KINDS.has(kind)) return "editor";
  if (CHAT_KINDS.has(kind)) return "chat";
  if (TERMINAL_KINDS.has(kind)) return "terminal";
  if (kind === "open_godot" || kind === "open_godot_editor") return "godot";
  return "generic";
}

function titleInitial(title: string): string {
  const first = Array.from(title.trim())[0];
  return first ? first.toLocaleUpperCase() : "•";
}

function Sketch({ background, children }: { background: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 320 88" width="100%" height="100%" aria-hidden="true" focusable="false">
      <rect width="320" height="88" rx="12" fill={background} />
      {children}
    </svg>
  );
}

function BrowserSketch({ kind }: { kind: string }) {
  const chrome = kind === "open_chrome";
  const edge = kind === "open_edge";
  const firefox = kind === "open_firefox";
  const bar = firefox ? "#ff7139" : edge ? "#e7f3fb" : chrome ? "#dee1e6" : "#d5e2ee";
  const page = firefox ? "#fff6f1" : edge ? "#f3f8fb" : "#f7f8fa";
  const accent = firefox ? "#ff7139" : edge ? "#0078d4" : chrome ? "#4285f4" : "#3d6f99";
  const dots = chrome
    ? ["#ea4335", "#fbbc05", "#34a853"]
    : edge
      ? ["#0078d4", "#36c6c0", "#5b9bd5"]
      : firefox
        ? ["rgba(255,255,255,0.95)", "rgba(255,255,255,0.72)", "rgba(255,255,255,0.95)"]
        : ["#8ea4b8", "#8ea4b8", "#8ea4b8"];

  return (
    <Sketch background={page}>
      <rect width="320" height="24" fill={bar} />
      <circle cx="14" cy="12" r="3.2" fill={dots[0]} />
      <circle cx="24" cy="12" r="3.2" fill={dots[1]} />
      <circle cx="34" cy="12" r="3.2" fill={dots[2]} />
      <rect x="52" y="7" width="168" height="10" rx="5" fill="rgba(255,255,255,0.92)" />
      {kind === "open_url" ? (
        <path
          d="M78 12h10M96 9.5a3.5 3.5 0 1 1 0 5h-6"
          fill="none"
          stroke={accent}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      ) : (
        <rect x="60" y="10" width="46" height="4" rx="2" fill={accent} opacity="0.8" />
      )}
      <rect x="16" y="36" width="108" height="8" rx="3" fill={accent} opacity="0.9" />
      <rect x="16" y="52" width="186" height="5" rx="2.5" fill="rgba(42,49,64,0.22)" />
      <rect x="16" y="64" width="142" height="5" rx="2.5" fill="rgba(42,49,64,0.14)" />
      <rect x="220" y="36" width="84" height="38" rx="8" fill="rgba(255,255,255,0.78)" />
      {edge ? <path d="M214 88c28-26 58-24 106-8v8H214z" fill="#36c6c0" /> : null}
      {edge ? <path d="M240 88c24-14 48-12 80-2v2H240z" fill="#0078d4" /> : null}
    </Sketch>
  );
}

function EditorSketch({ kind }: { kind: string }) {
  const cursor = kind === "open_cursor";
  const background = cursor ? "#1c1914" : "#1e1e1e";
  const accent = cursor ? "#f2efe9" : "#007acc";
  return (
    <Sketch background={background}>
      <rect width="320" height="14" fill={accent} />
      <rect y="14" width="28" height="74" fill="rgba(0,0,0,0.28)" />
      <rect x="8" y="24" width="12" height="12" rx="2" fill={cursor ? "#c4b8a8" : "#858585"} />
      <rect x="8" y="42" width="12" height="12" rx="2" fill="rgba(255,255,255,0.28)" />
      <rect x="28" y="14" width="78" height="74" fill="rgba(255,255,255,0.04)" />
      <rect x="38" y="28" width="52" height="4" rx="2" fill="rgba(255,255,255,0.38)" />
      <rect x="38" y="40" width="40" height="4" rx="2" fill="rgba(255,255,255,0.2)" />
      <rect x="38" y="52" width="46" height="4" rx="2" fill="rgba(255,255,255,0.2)" />
      <rect x="120" y="30" width="72" height="5" rx="2" fill={cursor ? "#d8c7a1" : "#569cd6"} />
      <rect x="132" y="42" width="96" height="5" rx="2" fill={cursor ? "#e8a87c" : "#ce9178"} />
      <rect x="132" y="54" width="58" height="5" rx="2" fill="#6a9955" />
      <rect x="120" y="66" width="44" height="5" rx="2" fill="rgba(255,255,255,0.72)" />
      {cursor ? <rect x="168" y="64" width="2" height="10" fill="#f7f1e8" /> : null}
    </Sketch>
  );
}

function ChatSketch({ kind }: { kind: string }) {
  const palettes: Record<
    string,
    { sidebar: string; canvas: string; incoming: string; outgoing: string; incomingInk: string; outgoingInk: string }
  > = {
    focus_discord: {
      sidebar: "#5865f2",
      canvas: "#313338",
      incoming: "#2b2d31",
      outgoing: "#5865f2",
      incomingInk: "rgba(255,255,255,0.78)",
      outgoingInk: "rgba(255,255,255,0.92)",
    },
    open_slack: {
      sidebar: "#4a154b",
      canvas: "#ffffff",
      incoming: "#f4ede4",
      outgoing: "#007a5a",
      incomingInk: "rgba(42,49,64,0.45)",
      outgoingInk: "rgba(255,255,255,0.9)",
    },
    open_teams: {
      sidebar: "#464eb8",
      canvas: "#f5f5f5",
      incoming: "#ffffff",
      outgoing: "#464eb8",
      incomingInk: "rgba(42,49,64,0.4)",
      outgoingInk: "rgba(255,255,255,0.9)",
    },
    open_whatsapp: {
      sidebar: "#075e54",
      canvas: "#ece5dd",
      incoming: "#ffffff",
      outgoing: "#dcf8c6",
      incomingInk: "rgba(42,49,64,0.4)",
      outgoingInk: "rgba(42,49,64,0.45)",
    },
    open_telegram: {
      sidebar: "#2aabee",
      canvas: "#ffffff",
      incoming: "#f4f4f5",
      outgoing: "#2aabee",
      incomingInk: "rgba(42,49,64,0.4)",
      outgoingInk: "rgba(255,255,255,0.92)",
    },
  };
  const palette = palettes[kind] ?? palettes.open_slack;
  return (
    <Sketch background={palette.canvas}>
      <rect width="78" height="88" fill={palette.sidebar} />
      <circle cx="22" cy="24" r="7" fill="rgba(255,255,255,0.92)" />
      <rect x="34" y="20" width="32" height="4" rx="2" fill="rgba(255,255,255,0.75)" />
      <rect x="34" y="28" width="22" height="3" rx="1.5" fill="rgba(255,255,255,0.45)" />
      <circle cx="22" cy="48" r="7" fill="rgba(255,255,255,0.62)" />
      <rect x="34" y="46" width="28" height="4" rx="2" fill="rgba(255,255,255,0.5)" />
      <rect x="94" y="20" width="118" height="24" rx="10" fill={palette.incoming} />
      <rect x="102" y="28" width="72" height="4" rx="2" fill={palette.incomingInk} />
      <rect x="102" y="36" width="48" height="3" rx="1.5" fill={palette.incomingInk} opacity="0.7" />
      <rect x="168" y="52" width="132" height="24" rx="10" fill={palette.outgoing} />
      <rect x="178" y="60" width="78" height="4" rx="2" fill={palette.outgoingInk} />
    </Sketch>
  );
}

function TerminalSketch({ kind }: { kind: string }) {
  const powershell = kind === "open_powershell";
  const command = kind === "open_command";
  const background = powershell ? "#012456" : "#0c0c0c";
  const chrome = powershell ? "#013a78" : "#1c1c1c";
  const ink = powershell ? "#f3f6fb" : "#d8d8d8";
  const prompt = command ? "C:\\>" : powershell ? "PS>" : ">";
  return (
    <Sketch background={background}>
      <rect width="320" height="18" fill={chrome} />
      <rect x="10" y="5" width="42" height="8" rx="2" fill={powershell ? "#4aa3ff" : command ? "#6e6e6e" : "#c94c4c"} />
      <text
        x="16"
        y="42"
        fill={ink}
        fontFamily="Cascadia Mono, Consolas, monospace"
        fontSize="12"
      >
        {prompt}
      </text>
      <rect x={command ? 52 : powershell ? 48 : 32} y="34" width="120" height="5" rx="2" fill={ink} opacity="0.85" />
      <rect x="16" y="54" width="168" height="5" rx="2" fill="#6a9955" />
      <rect x="16" y="68" width="104" height="5" rx="2" fill={ink} opacity="0.55" />
    </Sketch>
  );
}

function GodotSketch() {
  return (
    <Sketch background="#2c303b">
      <rect width="320" height="14" fill="#20232b" />
      <rect x="8" y="4" width="28" height="6" rx="2" fill="#478cbf" />
      <rect x="42" y="4" width="18" height="6" rx="2" fill="#6d9eeb" />
      <rect y="14" width="88" height="74" fill="#252830" />
      <circle cx="16" cy="32" r="3.5" fill="#8fd18a" />
      <rect x="24" y="29" width="50" height="5" rx="2" fill="rgba(255,255,255,0.72)" />
      <circle cx="24" cy="48" r="3.5" fill="#6cb6ff" />
      <rect x="32" y="45" width="40" height="5" rx="2" fill="rgba(255,255,255,0.48)" />
      <circle cx="24" cy="64" r="3.5" fill="#f0c36a" />
      <rect x="32" y="61" width="34" height="5" rx="2" fill="rgba(255,255,255,0.36)" />
      <rect x="98" y="24" width="136" height="52" rx="4" fill="#1c1e25" />
      <rect x="146" y="38" width="28" height="28" rx="3" fill="#478cbf" />
      <rect x="244" y="14" width="76" height="74" fill="#323746" />
      <rect x="254" y="26" width="54" height="4" rx="2" fill="rgba(255,255,255,0.4)" />
      <rect x="254" y="36" width="40" height="4" rx="2" fill="rgba(255,255,255,0.22)" />
      <rect x="254" y="46" width="48" height="4" rx="2" fill="rgba(255,255,255,0.22)" />
      <rect x="254" y="56" width="32" height="4" rx="2" fill="rgba(255,255,255,0.16)" />
    </Sketch>
  );
}

function GenericSketch({ title }: { title: string }) {
  return (
    <Sketch background="rgba(255,255,255,0.42)">
      <rect x="1" y="1" width="318" height="86" rx="12" fill="none" stroke="rgba(255,255,255,0.9)" />
      <rect x="20" y="28" width="40" height="32" rx="10" fill="rgba(255,255,255,0.78)" />
      <text
        x="40"
        y="49"
        textAnchor="middle"
        fontFamily="Segoe UI Variable, Segoe UI, sans-serif"
        fontSize="16"
        fontWeight="650"
        fill="#2a3140"
      >
        {titleInitial(title)}
      </text>
      <rect x="76" y="32" width="128" height="6" rx="3" fill="rgba(42,49,64,0.18)" />
      <rect x="76" y="46" width="88" height="6" rx="3" fill="rgba(42,49,64,0.12)" />
    </Sketch>
  );
}

export default function SuggestionPreview({ kind, title }: SuggestionsPreviewProps) {
  const family = sketchFamily(kind);
  let sketch: ReactNode;
  if (family === "browser") sketch = <BrowserSketch kind={kind} />;
  else if (family === "editor") sketch = <EditorSketch kind={kind} />;
  else if (family === "chat") sketch = <ChatSketch kind={kind} />;
  else if (family === "terminal") sketch = <TerminalSketch kind={kind} />;
  else if (family === "godot") sketch = <GodotSketch />;
  else sketch = <GenericSketch title={title} />;

  return (
    <div className="suggestion-preview" data-sketch={family}>
      {sketch}
    </div>
  );
}
