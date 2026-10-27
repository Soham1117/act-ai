/** Center-crop geometry matching a square CSS object-cover preview. */
export function getCenterSquareCrop(width: number, height: number) {
  const side = Math.min(width, height);
  return {
    x: (width - side) / 2,
    y: (height - side) / 2,
    width: side,
    height: side,
  };
}
