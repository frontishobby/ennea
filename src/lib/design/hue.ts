import { hash32 } from '../util/prng'

/**
 * A song's signature hue, derived from its slug. scripts/gen-covers.ts
 * paints the placeholder jacket with it and the select screen lights the
 * backdrop with it, so the two always agree. When real cover art lands,
 * this gets replaced by a colour sampled from the image.
 */
export const hueOf = (slug: string) => hash32(slug) % 360
