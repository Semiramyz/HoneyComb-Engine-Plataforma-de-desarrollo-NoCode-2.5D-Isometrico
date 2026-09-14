/** Recorte de un sprite dentro de su textura, en pixeles. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Estilo CSS que muestra SOLO el recorte de un sprite, escalado para caber en
 * un cuadrado de "box" pixeles. Funciona con la imagen completa y tambien con
 * su miniatura reducida: el tamano del fondo se calcula con las medidas REALES
 * de la imagen, y el navegador estira la miniatura hasta que el recorte cae
 * donde tiene que caer.
 *
 * Lo usan la paleta de personajes, la ventana de personajes y la de objetos.
 */
export function spriteCropStyle(
  dataUrl: string,
  imageWidth: number,
  imageHeight: number,
  rect: CropRect,
  box: number,
): Record<string, string> {
  const zoom = box / Math.max(rect.width, rect.height, 1);
  return {
    'background-image': `url(${dataUrl})`,
    'background-size': `${imageWidth * zoom}px ${imageHeight * zoom}px`,
    'background-position': `${-rect.x * zoom}px ${-rect.y * zoom}px`,
    width: `${rect.width * zoom}px`,
    height: `${rect.height * zoom}px`,
  };
}
