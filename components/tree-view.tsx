import { useId } from "react";
import type { StageIndex } from "@/lib/tree";

/**
 * 이번 달의 나무 그림 (SVG). 단계 index만 받아서 그리는 순수 컴포넌트.
 * 그리기 함수(rng/blob/trunk/branch/canopy/fruits)는 docs/design/home-screen-mockup.html 그대로다.
 * 색은 app/globals.css의 --leaf-1 등. 움직임은 .tree-sway / .tree-pop / .tree-twinkle
 * (prefers-reduced-motion이면 꺼진다).
 */

type Point = [number, number];
/** [x, y, 반지름] */
type Cluster = [number, number, number];

/** 같은 seed면 같은 수열 (mulberry32). 그림이 매번 같게 나오게 한다. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 울퉁불퉁한 둥근 덩어리 (잎 뭉치) 경로. */
function blob(cx: number, cy: number, rx: number, ry: number, n: number, amp: number, seed: number): string {
  const r = rng(seed);
  const pts: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (r() - 0.5) * amp;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  const mid = (p: Point, q: Point): Point => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const m0 = mid(pts[n - 1], pts[0]);
  let d = `M${m0[0].toFixed(1)} ${m0[1].toFixed(1)}`;
  for (let i = 0; i < n; i += 1) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % n]);
    d += `Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

function Canopy({ clusters, seed }: { clusters: Cluster[]; seed: number }) {
  return (
    <>
      {clusters.map((c, i) => (
        <path key={`s${i}`} d={blob(c[0] + 2, c[1] + 4, c[2], c[2] * 0.82, 11, 0.3, seed + i)} fill="var(--leaf-2)" />
      ))}
      {clusters.map((c, i) => (
        <path
          key={`m${i}`}
          className="tree-pop"
          style={{ animationDelay: `${i * 60}ms` }}
          d={blob(c[0], c[1], c[2], c[2] * 0.84, 12, 0.28, seed + 50 + i)}
          fill="var(--leaf-1)"
        />
      ))}
      {clusters.map((c, i) => (
        <path
          key={`h${i}`}
          d={blob(c[0] - c[2] * 0.3, c[1] - c[2] * 0.35, c[2] * 0.45, c[2] * 0.34, 9, 0.34, seed + 90 + i)}
          fill="var(--leaf-3)"
          opacity={0.75}
        />
      ))}
    </>
  );
}

function Trunk({ h, w, flare = 4 }: { h: number; w: number; flare?: number }) {
  const top = 150 - h;
  const half = w / 2;
  const f = flare;
  const body =
    `M${100 - half - f} 151 C${100 - half + 1} ${151 - h * 0.45} ${100 - half * 0.55} ${top + h * 0.3} ${100 - half * 0.42} ${top}` +
    ` L${100 + half * 0.42} ${top} C${100 + half * 0.5} ${top + h * 0.35} ${100 + half - 1} ${151 - h * 0.4} ${100 + half + f} 151 Z`;
  const bark = `M${100 - half * 0.25} ${top + 4} C${100 - half * 0.5} ${151 - h * 0.5} ${100 - half * 0.3} ${151 - h * 0.22} ${100 - half * 0.6} 148`;
  return (
    <>
      <path d={body} fill="var(--trunk)" />
      <path d={bark} fill="none" stroke="var(--bark)" strokeWidth={1.6} strokeLinecap="round" opacity={0.5} />
    </>
  );
}

function Branch({ x1, y1, x2, y2, w }: { x1: number; y1: number; x2: number; y2: number; w: number }) {
  const d = `M${x1} ${y1} Q${(x1 + x2) / 2 + (x2 - x1) * 0.1} ${y1 - 6} ${x2} ${y2}`;
  return <path d={d} fill="none" stroke="var(--trunk)" strokeWidth={w} strokeLinecap="round" />;
}

function Fruits({ list }: { list: Point[] }) {
  return (
    <>
      {list.map((f, i) => (
        <g key={i}>
          <circle className="tree-pop" style={{ animationDelay: `${420 + i * 70}ms` }} cx={f[0]} cy={f[1]} r={4.4} fill="var(--fruit)" />
          <circle cx={f[0] - 1.3} cy={f[1] - 1.5} r={1.4} fill="#fff" opacity={0.45} />
        </g>
      ))}
    </>
  );
}

function Art({ stage, glowId }: { stage: StageIndex; glowId: string }) {
  switch (stage) {
    case 0:
      return (
        <>
          <ellipse cx={100} cy={147} rx={13} ry={4.5} fill="var(--soil-2)" />
          <path d="M100 138c4 0 6.5 3 6.5 6s-3 5.5-6.5 5.5-6.5-2.5-6.5-5.5 2.5-6 6.5-6z" fill="var(--bark)" />
        </>
      );
    case 1:
      return (
        <>
          <path d="M100 150C99 142 100 136 100 130" stroke="var(--leaf-2)" strokeWidth={3} fill="none" strokeLinecap="round" />
          <path className="tree-pop" d="M100 134c-3-7-9-9-13-7 .5 6 6 9 13 7z" fill="var(--leaf-1)" />
          <path className="tree-pop" style={{ animationDelay: "110ms" }} d="M100 130c3-8 10-10 14-7-.5 7-6 10-14 7z" fill="var(--leaf-3)" />
        </>
      );
    case 2:
      return (
        <>
          <Trunk h={28} w={7} />
          <Branch x1={100} y1={128} x2={90} y2={120} w={3} />
          <Branch x1={100} y1={132} x2={111} y2={123} w={3} />
          <Canopy clusters={[[100, 112, 13], [87, 120, 9], [113, 119, 10]]} seed={7} />
        </>
      );
    case 3:
      return (
        <>
          <Trunk h={48} w={11} />
          <Branch x1={99} y1={122} x2={84} y2={110} w={4.5} />
          <Branch x1={101} y1={116} x2={117} y2={105} w={4.5} />
          <Canopy clusters={[[100, 96, 20], [80, 106, 14], [119, 101, 15]]} seed={21} />
        </>
      );
    case 4:
      return (
        <>
          <Trunk h={68} w={15} />
          <Branch x1={98} y1={116} x2={76} y2={100} w={6} />
          <Branch x1={102} y1={108} x2={125} y2={93} w={6} />
          <Branch x1={100} y1={98} x2={90} y2={86} w={4.5} />
          <Canopy clusters={[[100, 78, 25], [73, 94, 18], [127, 88, 19], [85, 72, 15], [117, 70, 14]]} seed={33} />
        </>
      );
    case 5:
      return (
        <>
          <Trunk h={80} w={19} flare={6} />
          <Branch x1={97} y1={112} x2={68} y2={94} w={7} />
          <Branch x1={103} y1={102} x2={132} y2={85} w={7} />
          <Branch x1={100} y1={90} x2={86} y2={74} w={5.5} />
          <Canopy clusters={[[100, 66, 29], [66, 88, 20], [134, 80, 21], [80, 60, 17], [122, 58, 16]]} seed={51} />
          <Fruits list={[[72, 95], [128, 86], [100, 44], [114, 66], [84, 68], [106, 90]]} />
        </>
      );
    case 6:
      return (
        <>
          <defs>
            <radialGradient id={glowId}>
              <stop offset="0" stopColor="var(--glow)" stopOpacity={0.45} />
              <stop offset="1" stopColor="var(--glow)" stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={100} cy={72} r={86} fill={`url(#${glowId})`} />
          <Trunk h={96} w={27} flare={11} />
          <path d="M78 151c6-9 12-13 18-15M122 151c-6-9-12-13-18-15" stroke="var(--trunk)" strokeWidth={8} fill="none" strokeLinecap="round" />
          <Branch x1={95} y1={110} x2={56} y2={88} w={8.5} />
          <Branch x1={105} y1={98} x2={146} y2={76} w={8.5} />
          <Branch x1={97} y1={86} x2={70} y2={62} w={6.5} />
          <Branch x1={103} y1={76} x2={128} y2={52} w={6.5} />
          <Canopy
            clusters={[[100, 50, 33], [56, 82, 23], [146, 72, 24], [70, 50, 20], [132, 42, 20], [100, 92, 17], [38, 102, 14], [162, 96, 14]]}
            seed={77}
          />
          <Fruits list={[[58, 90], [144, 80], [100, 24], [124, 46], [72, 40], [100, 98], [40, 106]]} />
          {([[26, 44, 2.6], [176, 54, 2.2], [52, 20, 2], [150, 16, 2.4], [14, 80, 2]] as Cluster[]).map((t, i) => (
            <circle key={i} className="tree-twinkle" style={{ animationDelay: `${i * 420}ms` }} cx={t[0]} cy={t[1]} r={t[2]} fill="var(--glow)" />
          ))}
        </>
      );
  }
}

export function TreeView({
  stage,
  title,
  sway = true,
  className,
}: {
  stage: StageIndex;
  /** 화면 읽기 도구용 설명 (예: "이번 달 나무: 어린나무") */
  title: string;
  /** 좌우로 천천히 흔들기. 지난 달 썸네일은 끈다. */
  sway?: boolean;
  className?: string;
}) {
  // 한 화면에 나무가 여러 개라 그라데이션 id가 겹치지 않게 한다.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const soilId = `soil-${uid}`;
  const glowId = `glow-${uid}`;
  const titleId = `tree-title-${uid}`;
  return (
    <svg viewBox="0 0 200 168" role="img" aria-labelledby={titleId} className={className}>
      <title id={titleId}>{title}</title>
      <defs>
        <linearGradient id={soilId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--soil)" />
          <stop offset="1" stopColor="var(--soil-2)" />
        </linearGradient>
      </defs>
      <circle cx={32} cy={28} r={14} fill="var(--sun)" opacity={0.5} />
      <path d="M150 38c0-6 5-10 11-9 2-5 9-6 12-2 5-1 9 3 8 8 4 1 5 7 1 9h-33c-4-1-4-5 1-6z" fill="#fff" opacity={0.4} />
      <rect x={0} y={146} width={200} height={24} fill={`url(#${soilId})`} />
      <path d="M0 148c22-5 40 2 62-1 24-3 40 4 62 1 20-3 36 2 76-2v5H0z" fill="var(--soil-2)" opacity={0.5} />
      <ellipse cx={100} cy={150} rx={44} ry={5} fill="#000" opacity={0.08} />
      <g className={sway ? "tree-sway" : undefined}>
        <Art stage={stage} glowId={glowId} />
      </g>
    </svg>
  );
}
