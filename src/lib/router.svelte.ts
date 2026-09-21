import type { ChartRef, Song } from './songs'

export type Route =
  | { screen: 'select' }
  | { screen: 'settings' }
  | { screen: 'play'; song: Song; chart: ChartRef }

export const nav: { route: Route } = $state({ route: { screen: 'select' } })

export const go = (route: Route) => {
  nav.route = route
}
