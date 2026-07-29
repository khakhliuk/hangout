type Props = {
  name: string
  url?: string | null
  highlight?: boolean
}

const SIZE = 40

export default function Avatar({ name, url, highlight }: Props) {
  const ring = highlight ? { boxShadow: '0 0 0 2px var(--tgui--button_color)' } : undefined
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        style={{ width: SIZE, height: SIZE, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, ...ring }}
      />
    )
  }
  return (
    <div
      style={{
        width: SIZE,
        height: SIZE,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: highlight ? 'var(--tgui--button_color)' : 'var(--tgui--secondary_fill)',
        color: highlight ? 'var(--tgui--button_text_color)' : 'var(--tgui--link_color)',
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {name[0]}
    </div>
  )
}
