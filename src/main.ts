import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { applyThemeAttribute } from '$lib/settings.svelte'

// Before mount, so the first paint is already in the player's theme.
applyThemeAttribute()

export default mount(App, { target: document.getElementById('app')! })
