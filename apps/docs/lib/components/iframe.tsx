export function Iframe({
  src,
  width = '100%',
  style,
  title = 'Embedded content',
}: {
  src: string;
  width?: string;
  style?: React.CSSProperties | string;
  title?: string;
}) {
  const resolvedStyle =
    typeof style === 'string'
      ? Object.fromEntries(
          style
            .split(';')
            .map((rule) => rule.trim())
            .filter(Boolean)
            .map((rule) => {
              const [key, value] = rule.split(':').map((part) => part.trim());
              const camelKey = key.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
              return [camelKey, value];
            }),
        )
      : style;

  return (
    <iframe
      src={src}
      width={width}
      style={resolvedStyle}
      title={title}
      loading="lazy"
      className="rounded-lg border"
    />
  );
}
