/**
 * The curvature law: every shape in ENNEA is a square rounded by the
 * same fraction of its shortest side. CSS spells it as `--curve: 22%`
 * in app.css; PixiJS spells it as `radiusFor(size)`. Keep them equal.
 */
export const CURVE = 0.22

export const radiusFor = (shortSide: number) => shortSide * CURVE
