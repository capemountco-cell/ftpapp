/**
 * Captain's icons: 16px on a 4px grid, 1.5px strokes, inline SVG. No icon font,
 * no dependency.
 */

import type { FileKind } from "../lib/format";
import { LOGO_ASPECT, LOGO_PATH, LOGO_VIEWBOX } from "./captain-logo";

type P = { className?: string; style?: React.CSSProperties };

const s = { stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

const svg = (children: React.ReactNode, { className, style }: P = {}) => (
  <svg className={className ?? "i"} style={style} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    {children}
  </svg>
);

export const ArrowLeft = (p: P) => svg(<path d="M13 8H3.5M7.5 4 3.5 8l4 4" {...s} />, p);
export const ArrowRight = (p: P) => svg(<path d="M3 8h9.5M8.5 4l4 4-4 4" {...s} />, p);
export const ArrowUp = (p: P) => svg(<path d="M8 13V3.5M4 7.5l4-4 4 4" {...s} />, p);
export const ArrowDown = (p: P) => svg(<path d="M8 3v9.5M4 8.5l4 4 4-4" {...s} />, p);
export const Clock = (p: P) =>
  svg(
    <>
      <circle cx="8" cy="8" r="5.75" {...s} />
      <path d="M8 4.75V8h2.75" {...s} />
    </>,
    p,
  );
export const Search = (p: P) =>
  svg(
    <>
      <circle cx="7" cy="7" r="4.25" {...s} />
      <path d="m10.25 10.25 3 3" {...s} />
    </>,
    p,
  );
export const Compose = (p: P) =>
  svg(
    <>
      <path d="M7.25 2.75h-3a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-3" {...s} />
      <path d="m6.5 9.5.5-2.25 5.25-5.25a1.06 1.06 0 0 1 1.5 1.5L8.5 8.75 6.5 9.5Z" {...s} />
    </>,
    p,
  );
export const Transfers = (p: P) => svg(<path d="M5 12.5V3.5M2.5 6 5 3.5 7.5 6M11 3.5v9M8.5 10l2.5 2.5 2.5-2.5" {...s} />, p);
export const Server = (p: P) =>
  svg(
    <>
      <rect x="2.75" y="2.75" width="10.5" height="4.5" rx="1.25" {...s} />
      <rect x="2.75" y="8.75" width="10.5" height="4.5" rx="1.25" {...s} />
      <path d="M5.25 5h.01M5.25 11h.01" {...s} strokeWidth={2} />
    </>,
    p,
  );
export const Folder = (p: P) =>
  svg(<path d="M2.25 4.5v7.25c0 .69.56 1.25 1.25 1.25h9c.69 0 1.25-.56 1.25-1.25v-5.5c0-.69-.56-1.25-1.25-1.25H8L6.5 3.25h-3c-.69 0-1.25.56-1.25 1.25Z" {...s} />, p);
export const FolderFill = (p: P) =>
  svg(
    <path
      d="M2.25 4.5v7.25c0 .69.56 1.25 1.25 1.25h9c.69 0 1.25-.56 1.25-1.25v-5.5c0-.69-.56-1.25-1.25-1.25H8L6.5 3.25h-3c-.69 0-1.25.56-1.25 1.25Z"
      fill="currentColor"
      fillOpacity={0.22}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
    />,
    p,
  );
const page = "M4.5 2.25h4.75L12 5v8.25c0 .28-.22.5-.5.5h-7a.5.5 0 0 1-.5-.5V2.75c0-.28.22-.5.5-.5Z M9.25 2.25V5H12";
export const FileIcon = (p: P) => svg(<path d={page} {...s} />, p);
export const FileCode = (p: P) =>
  svg(
    <>
      <path d={page} {...s} />
      <path d="m6.75 8.5-1.25 1.25L6.75 11M9.25 8.5l1.25 1.25L9.25 11" {...s} strokeWidth={1.25} />
    </>,
    p,
  );
export const FileImage = (p: P) =>
  svg(
    <>
      <rect x="2.75" y="3.25" width="10.5" height="9.5" rx="1.5" {...s} />
      <circle cx="6" cy="6.5" r="1" fill="currentColor" />
      <path d="m3.25 11.5 3-3 2.25 2.25 1.5-1.5 2.75 2.75" {...s} />
    </>,
    p,
  );
export const FileArchive = (p: P) =>
  svg(
    <>
      <path d={page} {...s} />
      <path d="M7 4.5h1M7 6.5h1M7 8.5h1" {...s} strokeWidth={1.25} />
      <rect x="6.5" y="10" width="2" height="2" rx=".5" {...s} strokeWidth={1.25} />
    </>,
    p,
  );
export const FileText = (p: P) =>
  svg(
    <>
      <path d={page} {...s} />
      <path d="M6 8h4M6 10.25h3" {...s} strokeWidth={1.25} />
    </>,
    p,
  );
export const FileMedia = (p: P) =>
  svg(
    <>
      <path d={page} {...s} />
      <path d="M7 8.25v3l2.5-1.5L7 8.25Z" {...s} strokeWidth={1.25} />
    </>,
    p,
  );
export const Upload = (p: P) => svg(<path d="M8 10.5V2.75M4.75 6 8 2.75 11.25 6M2.75 10.5v1.75c0 .55.45 1 1 1h8.5c.55 0 1-.45 1-1V10.5" {...s} />, p);
export const Download = (p: P) => svg(<path d="M8 2.75v7.75M4.75 7.25 8 10.5l3.25-3.25M2.75 10.5v1.75c0 .55.45 1 1 1h8.5c.55 0 1-.45 1-1V10.5" {...s} />, p);
export const FolderPlus = (p: P) =>
  svg(
    <>
      <path d="M13.75 7.5V6.25c0-.69-.56-1.25-1.25-1.25H8L6.5 3.25h-3c-.69 0-1.25.56-1.25 1.25v7.25c0 .69.56 1.25 1.25 1.25H8" {...s} />
      <path d="M12 9.5v4M10 11.5h4" {...s} />
    </>,
    p,
  );
export const FilePlus = (p: P) =>
  svg(
    <>
      <path d="M8.5 13.75h-4a.5.5 0 0 1-.5-.5V2.75c0-.28.22-.5.5-.5h4.75L12 5v3" {...s} />
      <path d="M11.5 10v4M9.5 12h4" {...s} />
    </>,
    p,
  );
export const Refresh = (p: P) =>
  svg(<path d="M12.75 6.5A5 5 0 0 0 3.6 5.25M3.25 9.5a5 5 0 0 0 9.15 1.25M3.5 2.75v2.75h2.75M12.5 13.25V10.5H9.75" {...s} />, p);
export const PanelRight = (p: P) =>
  svg(
    <>
      <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2" {...s} />
      <path d="M10 2.75v10.5" {...s} />
    </>,
    p,
  );
export const More = (p: P) =>
  svg(
    <>
      <circle cx="3.5" cy="8" r="1.1" fill="currentColor" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.1" fill="currentColor" />
    </>,
    p,
  );
export const Star = (p: P) =>
  svg(<path d="m8 2.5 1.65 3.4 3.7.53-2.68 2.6.63 3.7L8 10.97l-3.3 1.76.63-3.7-2.68-2.6 3.7-.53L8 2.5Z" {...s} />, p);
export const StarFill = (p: P) =>
  svg(<path d="m8 2.5 1.65 3.4 3.7.53-2.68 2.6.63 3.7L8 10.97l-3.3 1.76.63-3.7-2.68-2.6 3.7-.53L8 2.5Z" fill="currentColor" stroke="currentColor" strokeWidth={1.25} strokeLinejoin="round" />, p);
export const Caret = (p: P) => svg(<path d="M5 6.5h6L8 10 5 6.5Z" fill="currentColor" />, p);
export const CaretRight = (p: P) => svg(<path d="M6.5 5v6L10 8 6.5 5Z" fill="currentColor" />, p);
export const ChevronDown = (p: P) => svg(<path d="m4.5 6.5 3.5 3.5 3.5-3.5" {...s} />, p);
export const ChevronRight = (p: P) => svg(<path d="m6.5 4.5 3.5 3.5-3.5 3.5" {...s} />, p);
export const Close = (p: P) => svg(<path d="m4.5 4.5 7 7M11.5 4.5l-7 7" {...s} />, p);
export const Check = (p: P) => svg(<path d="m3.75 8.25 2.75 2.75 5.75-6" {...s} />, p);
export const CheckCircle = (p: P) =>
  svg(
    <>
      <circle cx="8" cy="8" r="6" {...s} />
      <path d="m5.5 8.25 1.75 1.75 3.25-3.5" {...s} />
    </>,
    p,
  );
export const XCircle = (p: P) =>
  svg(
    <>
      <circle cx="8" cy="8" r="6" {...s} />
      <path d="m6 6 4 4m0-4-4 4" {...s} />
    </>,
    p,
  );
export const Pencil = (p: P) => svg(<path d="M10.25 3.25 12.75 5.75 6 12.5l-3.25.75.75-3.25 6.75-6.75Z" {...s} />, p);
export const Trash = (p: P) => svg(<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1c.04.5.46.9.97.9h3.86c.51 0 .93-.4.97-.9l.6-8.1" {...s} />, p);
export const Copy = (p: P) =>
  svg(
    <>
      <rect x="5.25" y="5.25" width="8" height="8" rx="1.5" {...s} />
      <path d="M10.75 5.25V4.25c0-.83-.67-1.5-1.5-1.5h-4.5c-.83 0-1.5.67-1.5 1.5v4.5c0 .83.67 1.5 1.5 1.5h.5" {...s} />
    </>,
    p,
  );
export const Link = (p: P) =>
  svg(<path d="M7 9a2.5 2.5 0 0 0 3.54 0l2-2a2.5 2.5 0 0 0-3.54-3.54l-.5.5M9 7a2.5 2.5 0 0 0-3.54 0l-2 2a2.5 2.5 0 0 0 3.54 3.54l.5-.5" {...s} />, p);
export const Lock = (p: P) =>
  svg(
    <>
      <rect x="3.25" y="7" width="9.5" height="6.5" rx="1.5" {...s} />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" {...s} />
    </>,
    p,
  );
export const Key = (p: P) =>
  svg(
    <>
      <circle cx="5.5" cy="10.5" r="2.75" {...s} />
      <path d="m7.5 8.5 5.25-5.25M10.5 5.5l1.5 1.5M11.75 4.25l1.25 1.25" {...s} />
    </>,
    p,
  );
export const External = (p: P) => svg(<path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5 7.5 8.5" {...s} />, p);
export const Warning = (p: P) =>
  svg(
    <>
      <path d="M8 2.75 13.75 13H2.25L8 2.75Z" {...s} />
      <path d="M8 6.75v2.5M8 11.1v.15" {...s} />
    </>,
    p,
  );
export const Shield = (p: P) =>
  svg(
    <>
      <path d="M8 2.25 3 4v4c0 3 2.25 5 5 5.75 2.75-.75 5-2.75 5-5.75V4L8 2.25Z" {...s} />
      <path d="m6 8 1.5 1.5L10.25 6.5" {...s} />
    </>,
    p,
  );
export const Plug = (p: P) => svg(<path d="M6 2.75v3M10 2.75v3M4.25 5.75h7.5V8a3.75 3.75 0 0 1-7.5 0V5.75ZM8 11.75v1.5" {...s} />, p);
export const Command = (p: P) =>
  svg(<path d="M6 6V4.5a1.5 1.5 0 1 0-1.5 1.5H6Zm0 0v4m0-4h4m-4 4H4.5A1.5 1.5 0 1 0 6 11.5V10Zm0 0h4m0-4V4.5A1.5 1.5 0 1 1 11.5 6H10Zm0 0v4m0 0v1.5a1.5 1.5 0 1 0 1.5-1.5H10Z" {...s} />, p);
export const Plus = (p: P) => svg(<path d="M8 3.25v9.5M3.25 8h9.5" {...s} />, p);
export const Home = (p: P) => svg(<path d="M2.75 7.25 8 2.75l5.25 4.5V13a.5.5 0 0 1-.5.5h-3v-3.75h-3.5v3.75h-3a.5.5 0 0 1-.5-.5V7.25Z" {...s} />, p);
export const Stop = (p: P) =>
  svg(
    <>
      <circle cx="8" cy="8" r="6" {...s} />
      <rect x="6" y="6" width="4" height="4" rx=".75" fill="currentColor" />
    </>,
    p,
  );
export const Eye = (p: P) =>
  svg(
    <>
      <path d="M2 8s2.25-4 6-4 6 4 6 4-2.25 4-6 4-6-4-6-4Z" {...s} />
      <circle cx="8" cy="8" r="1.75" {...s} />
    </>,
    p,
  );
export const Code = (p: P) => svg(<path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5 14 8l-3.5 3.5" {...s} />, p);
export const Sliders = (p: P) => svg(<path d="M3 5h6M12 5h1M3 11h1M7 11h6M10.5 3.5v3M5.5 9.5v3" {...s} />, p);
export const Question = (p: P) =>
  svg(
    <>
      <circle cx="8" cy="8" r="6" {...s} />
      <path d="M6.4 6.25a1.7 1.7 0 0 1 3.3.5c0 1.15-1.7 1.5-1.7 2.5M8 11.1v.15" {...s} />
    </>,
    p,
  );

const KIND_ICON: Record<FileKind, (p: P) => React.ReactElement> = {
  folder: FolderFill,
  code: FileCode,
  image: FileImage,
  archive: FileArchive,
  text: FileText,
  media: FileMedia,
  doc: FileText,
  file: FileIcon,
};

/** The icon for a listing row, tinted by kind. */
export function KindIcon({ kind, className }: { kind: FileKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon className={`i k-${kind}${className ? " " + className : ""}`} />;
}

/** The Captain signature, in the current text colour. `height` sets its size. */
export function Wordmark({ height = 22, className = "wordmark" }: { height?: number; className?: string }) {
  return (
    <svg className={className} height={height} width={height * LOGO_ASPECT} viewBox={LOGO_VIEWBOX} role="img" aria-label="Captain">
      <path fill="currentColor" fillRule="evenodd" d={LOGO_PATH} />
    </svg>
  );
}

/** A site's glyph: the server icon, grey like every other icon. A site is
 *  told apart by its name, not a colour. */
export function SiteGlyph({ className }: { className?: string }) {
  return <Server className={className ?? "i"} />;
}
