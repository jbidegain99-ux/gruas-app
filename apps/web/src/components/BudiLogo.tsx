export function BudiLogo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      <rect width="40" height="40" rx="10" className="fill-budi-primary-500" />
      <text
        x="50%"
        y="54%"
        dominantBaseline="middle"
        textAnchor="middle"
        className="fill-white"
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight="800"
        fontSize="18"
      >
        B
      </text>
    </svg>
  );
}
