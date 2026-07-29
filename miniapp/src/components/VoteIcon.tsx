export default function VoteIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      style={{ display: 'block' }}
    >
      <rect x="3" y="13" width="4.5" height="8" rx="1.2" />
      <rect x="9.75" y="8" width="4.5" height="13" rx="1.2" />
      <rect x="16.5" y="3" width="4.5" height="18" rx="1.2" />
    </svg>
  )
}
