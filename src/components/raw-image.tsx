import type { ImgHTMLAttributes } from "react";

export function RawImage({ alt = "", ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  // eslint-disable-next-line @next/next/no-img-element -- existing remote and blob image layout must stay unchanged during lint cleanup
  return <img alt={alt} {...props} />;
}
