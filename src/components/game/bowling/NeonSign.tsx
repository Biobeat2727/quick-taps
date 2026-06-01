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
    textAnchor: 'middle' as const,
    fontFamily: "'Dancing Script', cursive",
    fontSize,
    fill: 'none',
  };

  return (
    <g>
      {/* Wide soft ambient bloom */}
      <text {...shared} stroke={color} strokeWidth={fontSize * 0.18} opacity={0.12} filter={`url(#${softGlowId})`}>{children}</text>
      {/* Outer glass tube body */}
      <text {...shared} stroke="#000" strokeWidth={fontSize * 0.075} strokeOpacity={0.75}>{children}</text>
      {/* Colored neon gas fill */}
      <text {...shared} stroke={color} strokeWidth={fontSize * 0.048} filter={`url(#${glowId})`} opacity={0.95}>{children}</text>
      {/* Bright hot core */}
      <text {...shared} stroke="white" strokeWidth={fontSize * 0.018} opacity={0.75}>{children}</text>
      {/* Specular glass highlight */}
      <text {...shared} stroke="white" strokeWidth={fontSize * 0.008} opacity={0.45} transform={`translate(0, ${fontSize * -0.022})`}>{children}</text>
    </g>
  );
}

export function NeonSign() {
  const pink = '#ff2d78';
  const blue = '#00e5ff';

  return (
    <svg
      viewBox="0 0 640 340"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <filter id="neon-glow-pink" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.5" result="b1" />
          <feGaussianBlur stdDeviation="6" result="b2" />
          <feMerge>
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="neon-glow-blue" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.5" result="b1" />
          <feGaussianBlur stdDeviation="6" result="b2" />
          <feMerge>
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="neon-soft-pink" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
        <filter id="neon-soft-blue" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
        <filter id="neon-bg-bloom" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="35" />
        </filter>
      </defs>

      {/* Background wall glow */}
      <ellipse cx="320" cy="130" rx="280" ry="90" fill={pink} opacity="0.07" filter="url(#neon-bg-bloom)" />
      <ellipse cx="320" cy="270" rx="200" ry="60" fill={blue} opacity="0.08" filter="url(#neon-bg-bloom)" />

      {/* "Quick Taps" — pink neon */}
      <NeonText x={320} y={148} fontSize={118} color={pink} glowId="neon-glow-pink" softGlowId="neon-soft-pink">
        Quick Taps
      </NeonText>

      {/* "Bowling" — blue neon */}
      <NeonText x={320} y={278} fontSize={90} color={blue} glowId="neon-glow-blue" softGlowId="neon-soft-blue">
        Bowling
      </NeonText>
    </svg>
  );
}
