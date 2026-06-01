export default function App() {
  return (
    <div
      className="size-full flex items-center justify-center"
      style={{ background: "#0a0010" }}
    >
      {/* MARKER-MAKE-KIT-INVOKED */}
      <NeonSign />
    </div>
  );
}

// Renders text as layered strokes to simulate a cylindrical glass neon tube:
// outer glow → dark glass rim → colored gas → hot bright core → specular highlight
function NeonText({
  children,
  x,
  y,
  fontSize,
  color,
  glowId,
  softGlowId,
}: {
  children: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  glowId: string;
  softGlowId: string;
}) {
  const shared = {
    x,
    y,
    textAnchor: "middle" as const,
    fontFamily: "'Dancing Script', cursive",
    fontSize,
    fill: "none",
  };

  return (
    <g>
      {/* 1. Wide soft ambient bloom */}
      <text {...shared} stroke={color} strokeWidth={fontSize * 0.18} opacity={0.12} filter={`url(#${softGlowId})`}>{children}</text>

      {/* 2. Outer glass tube body — dark translucent rim gives tube depth */}
      <text {...shared} stroke="#000" strokeWidth={fontSize * 0.075} strokeOpacity={0.75}>{children}</text>

      {/* 3. Colored neon gas fill inside the tube */}
      <text {...shared} stroke={color} strokeWidth={fontSize * 0.048} filter={`url(#${glowId})`} opacity={0.95}>{children}</text>

      {/* 4. Bright hot core — slightly desaturated white tint */}
      <text {...shared} stroke="white" strokeWidth={fontSize * 0.018} opacity={0.75}>{children}</text>

      {/* 5. Specular glass highlight — thin white line offset toward top, like light
              catching the curved top surface of the glass tube */}
      <text {...shared} stroke="white" strokeWidth={fontSize * 0.008} opacity={0.45} transform={`translate(0, ${fontSize * -0.022})`}>{children}</text>
    </g>
  );
}

function NeonSign() {
  const pink = "#ff2d78";
  const blue = "#00e5ff";

  return (
    <svg
      viewBox="0 0 640 340"
      width="640"
      height="340"
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: "visible" }}
    >
      <defs>
        {/* Tight crisp glow — keeps the tube edge sharp */}
        <filter id="glow-pink" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.5" result="b1" />
          <feGaussianBlur stdDeviation="6" result="b2" />
          <feMerge>
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="glow-blue" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.5" result="b1" />
          <feGaussianBlur stdDeviation="6" result="b2" />
          <feMerge>
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Wide soft bloom for ambient wall-glow */}
        <filter id="soft-pink" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
        <filter id="soft-blue" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="22" />
        </filter>

        <filter id="bg-bloom" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="35" />
        </filter>
      </defs>

      {/* Background wall glow */}
      <ellipse cx="320" cy="130" rx="280" ry="90" fill={pink} opacity="0.07" filter="url(#bg-bloom)" />
      <ellipse cx="320" cy="270" rx="200" ry="60" fill={blue} opacity="0.08" filter="url(#bg-bloom)" />

      {/* "Quick Taps" — pink neon glass tubes */}
      <NeonText x={320} y={148} fontSize={118} color={pink} glowId="glow-pink" softGlowId="soft-pink">
        Quick Taps
      </NeonText>

      {/* "Bowling" — blue neon glass tubes */}
      <NeonText x={320} y={278} fontSize={90} color={blue} glowId="glow-blue" softGlowId="soft-blue">
        Bowling
      </NeonText>
    </svg>
  );
}
