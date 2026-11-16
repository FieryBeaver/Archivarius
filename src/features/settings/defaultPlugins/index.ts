import daggerheartSheet from './daggerheart-sheet.html?raw'

/**
 * Starter plugins bundled with the app (v0.7): ready-made plugins (currently
 * the Daggerheart sheet) an owner can add to a world with one click. Adding
 * one goes through the normal plugin mechanism (createPlugin uploads the
 * HTML), so the world's copy is
 * independent — editable, replaceable and exported like any uploaded plugin.
 */
export interface StarterPlugin {
  /** Stable key for "already added" detection (matched against plugin names). */
  key: string
  name: string
  icon: string
  blurb: string
  source: string
}

export const STARTER_PLUGINS: StarterPlugin[] = [
  {
    key: 'daggerheart-sheet',
    name: 'Daggerheart Sheet',
    icon: 'gi:GiDaggers',
    blurb: 'A player sheet for the Daggerheart TTRPG: six traits, Evasion, Armor, HP, Stress and Hope tracks, experiences, weapons and domain cards.',
    source: daggerheartSheet,
  },
]
