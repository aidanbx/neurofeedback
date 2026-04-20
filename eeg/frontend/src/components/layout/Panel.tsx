import type { ReactNode, CSSProperties } from 'react';

interface Props {
  title?: string;
  children: ReactNode;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
}

export function Panel({ title, children, style, bodyStyle }: Props) {
  return (
    <div className="panel" style={style}>
      {title && <div className="panel-title">{title}</div>}
      <div className="panel-body" style={bodyStyle}>{children}</div>
    </div>
  );
}
