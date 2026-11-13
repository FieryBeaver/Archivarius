/**
 * Shared icon system (fixed/shared file — see CONTRACT.md).
 *
 * Icon strings stored in the DB (pages.icon, pins.icon) are plain strings:
 *   - an emoji (legacy), e.g. "🗺"
 *   - "gi:<ExportName>" referencing a react-icons Game Icons export, e.g. "gi:GiCastle"
 *
 * Only the curated icons in ICON_CHOICES (plus the kind defaults) can be
 * resolved — this keeps the bundle small (no import of all of react-icons/gi).
 * An unknown "gi:" name renders nothing.
 *
 * Game Icons (game-icons.net) are licensed CC BY 3.0 — credit in the about/settings UI.
 */
import type { ReactNode } from 'react'
import type { IconType } from 'react-icons'
import {
  // Places
  GiCastle, GiCastleRuins, GiVillage, GiWatchtower, GiStoneTower, 
  GiCaveEntrance, GiStoneWall, GiChurch, GiTempleGate, GiGreekTemple,
  GiTavernSign, GiHouse, GiWoodCabin, 
  GiBridge, GiLighthouse, GiWindmill, GiAncientRuins, 
  GiDungeonGate, GiArena, GiGreatPyramid, GiObelisk, GiMedievalGate, GiGraveyard,
  GiTombstone, GiShop, GiAnvil, GiBookshelf, GiIndianPalace,
  GiLockedFortress, GiHarborDock, GiCrystalShrine, GiCampingTent,
  // Nature
  GiMountains, GiMountainCave, GiPeaks, GiForest, GiPineTree, GiOak, GiPalmTree,
  GiRiver, GiWaterfall, GiWaves, GiIsland,
  GiVolcano, GiDesert, GiCactus, GiSwamp, GiIceberg, GiSnowflake1,
  GiFlowers, GiRose, GiMushroom, GiMapleLeaf, GiSprout, 
  GiWheat, GiCrystalGrowth, GiCrystalCluster, GiGems, GiStonePile, GiSeaCliff,
  // People & Creatures
  GiMountedKnight, GiWizardFace, GiWitchFace, GiWomanElfFace,
  GiDwarfFace, GiHoodedFigure, GiPirateCaptain,
  GiVikingHead, GiBowman, GiQueenCrown, GiPerson,
  GiThreeFriends, GiFamilyTree, GiDragonHead, GiSpikedDragonHead, 
  GiSeaDragon, GiSkeleton, GiGhost, GiShamblingZombie, GiVampireDracula, GiWerewolf,
  GiWolfHead, GiOrcHead, GiGoblinHead, GiMinotaur, GiCyclops,
  GiFairy, GiUnicorn, GiGriffinSymbol, 
  GiKrakenTentacle, GiSpiderFace, GiRaven, GiOwl, GiEagleHead, GiLion, GiBearHead,
  GiHorseHead, GiSnake, GiDevilMask, GiAngelWings,
  // Items
  GiBroadsword, GiTwoHandedSword, GiBattleAxe, GiWarhammer, GiDaggers,
  GiBowArrow, GiSpikedMace, GiShield, GiHelmet,
  GiBreastplate, GiPotionBall, GiMagicPotion, GiScrollUnfurled,
  GiTiedScroll, GiSpellBook, GiOpenBook, GiQuillInk, GiKey,
  GiCrown, GiRing, GiGemPendant, GiCrystalBall,
  GiWizardStaff, GiFairyWand, GiChest, GiOpenTreasureChest, GiCoins,
  GiGoldBar, GiHolyGrail, GiLantern, GiTorch,
  GiHourglass, GiBackpack, GiBeerStein, GiSwordInStone, GiLoveLetter,
  // Travel & Maps
  GiCompass, GiTreasureMap, GiAnchor, GiShipWheel, GiSailboat, GiGalleon, 
  GiShipWreck, GiFishingBoat, GiRaft, GiHorseshoe, GiPathDistance, 
  GiRoad, GiMountainRoad, GiCrossroad, GiDirectionSigns, GiWoodenSign, GiFootprint,
  GiTrail, GiCaravan, GiOldWagon, GiSpyglass, GiWorld, GiPositionMarker,
  GiFlagObjective, GiAirBalloon, GiPortal,
  // Factions & Symbols
  GiKnightBanner, GiVerticalBanner, GiPirateFlag, GiCrossedSwords,
  GiRuneStone, GiRuneSword, GiSkullCrossedBones, GiCrownedSkull,
  GiHolySymbol, GiAnkh, GiPentagramRose, GiTriquetra, GiYinYang, GiEyeOfHorus,
  GiAllSeeingEye, GiLaurelCrown, GiCheckedShield, GiGriffinShield, 
  GiEagleEmblem, GiSwordsEmblem, GiFist, GiScales, GiJerusalemCross, 
  GiTrophy, GiMedal, GiThreeKeys,
  // Events & Time
  GiSandsOfTime, GiSundial, GiCalendar, GiSun, GiSunrise, GiSunset, GiMoon, 
  GiNightSky, GiEclipse, GiCometSpark, GiLightningStorm, GiRaining, GiSnowing, GiTornado,
  GiFlood, GiEarthCrack, GiFire, GiExplosionRays,
  GiDuel, GiSwordClash, GiBloodySword, GiSiegeTower, GiCatapult, 
  GiPeaceDove, GiCoffin, GiPlagueDoctorProfile, GiPartyPopper, GiTrumpetFlag,
} from 'react-icons/gi'
import type { Page, PageKind } from './types'

export type IconChoice = { id: string; name: string; Icon: IconType }
export type IconCategory = { category: string; icons: IconChoice[] }

const GI_PREFIX = 'gi:'

/** Build an entry: id = "gi:<ExportName>", name = lowercase search text. */
function c(Icon: IconType, exportName: string, name: string): IconChoice {
  return { id: GI_PREFIX + exportName, name, Icon }
}

export const ICON_CHOICES: IconCategory[] = [
  {
    category: 'Places',
    icons: [
      c(GiCastle, 'GiCastle', 'castle keep fortress'),
      c(GiCastleRuins, 'GiCastleRuins', 'castle ruins'),
      c(GiVillage, 'GiVillage', 'village town settlement'),
      c(GiWatchtower, 'GiWatchtower', 'watchtower outpost'),
      c(GiStoneTower, 'GiStoneTower', 'stone tower'),
      c(GiCaveEntrance, 'GiCaveEntrance', 'cave entrance'),
      c(GiStoneWall, 'GiStoneWall', 'stone wall'),
      c(GiChurch, 'GiChurch', 'church chapel'),
      c(GiTempleGate, 'GiTempleGate', 'temple gate shrine'),
      c(GiGreekTemple, 'GiGreekTemple', 'greek temple'),
      c(GiTavernSign, 'GiTavernSign', 'tavern inn'),
      c(GiHouse, 'GiHouse', 'house home'),
      c(GiWoodCabin, 'GiWoodCabin', 'wood cabin lodge'),
      c(GiCampingTent, 'GiCampingTent', 'tent camp'),
      c(GiBridge, 'GiBridge', 'bridge'),
      c(GiLighthouse, 'GiLighthouse', 'lighthouse'),
      c(GiWindmill, 'GiWindmill', 'windmill mill'),
      c(GiAncientRuins, 'GiAncientRuins', 'ancient ruins'),
      c(GiDungeonGate, 'GiDungeonGate', 'dungeon gate'),
      c(GiArena, 'GiArena', 'arena colosseum'),
      c(GiGreatPyramid, 'GiGreatPyramid', 'pyramid'),
      c(GiObelisk, 'GiObelisk', 'obelisk monument'),
      c(GiMedievalGate, 'GiMedievalGate', 'medieval gate city gate'),
      c(GiGraveyard, 'GiGraveyard', 'graveyard cemetery'),
      c(GiTombstone, 'GiTombstone', 'tombstone grave'),
      c(GiShop, 'GiShop', 'shop store market'),
      c(GiAnvil, 'GiAnvil', 'anvil smithy forge'),
      c(GiBookshelf, 'GiBookshelf', 'bookshelf library'),
      c(GiIndianPalace, 'GiIndianPalace', 'palace'),
      c(GiLockedFortress, 'GiLockedFortress', 'fortress stronghold'),
      c(GiHarborDock, 'GiHarborDock', 'harbor dock port'),
      c(GiCrystalShrine, 'GiCrystalShrine', 'crystal shrine'),
    ],
  },
  {
    category: 'Nature',
    icons: [
      c(GiMountains, 'GiMountains', 'mountains'),
      c(GiMountainCave, 'GiMountainCave', 'mountain cave'),
      c(GiPeaks, 'GiPeaks', 'peaks summit'),
      c(GiForest, 'GiForest', 'forest woods'),
      c(GiPineTree, 'GiPineTree', 'pine tree'),
      c(GiOak, 'GiOak', 'oak tree'),
      c(GiPalmTree, 'GiPalmTree', 'palm tree tropical'),
      c(GiRiver, 'GiRiver', 'river'),
      c(GiWaterfall, 'GiWaterfall', 'waterfall'),
      c(GiWaves, 'GiWaves', 'waves sea ocean water'),
      c(GiIsland, 'GiIsland', 'island'),
      c(GiVolcano, 'GiVolcano', 'volcano'),
      c(GiDesert, 'GiDesert', 'desert dunes'),
      c(GiCactus, 'GiCactus', 'cactus'),
      c(GiSwamp, 'GiSwamp', 'swamp marsh bog'),
      c(GiIceberg, 'GiIceberg', 'iceberg glacier'),
      c(GiSnowflake1, 'GiSnowflake1', 'snowflake winter ice'),
      c(GiFlowers, 'GiFlowers', 'flowers meadow'),
      c(GiRose, 'GiRose', 'rose flower'),
      c(GiMushroom, 'GiMushroom', 'mushroom'),
      c(GiMapleLeaf, 'GiMapleLeaf', 'maple leaf autumn'),
      c(GiSprout, 'GiSprout', 'sprout growth'),
      c(GiWheat, 'GiWheat', 'wheat farm harvest'),
      c(GiCrystalGrowth, 'GiCrystalGrowth', 'crystal growth'),
      c(GiCrystalCluster, 'GiCrystalCluster', 'crystal cluster'),
      c(GiGems, 'GiGems', 'gems jewels'),
      c(GiStonePile, 'GiStonePile', 'stone pile rocks'),
      c(GiSeaCliff, 'GiSeaCliff', 'sea cliff coast'),
    ],
  },
  {
    category: 'People & Creatures',
    icons: [
      c(GiMountedKnight, 'GiMountedKnight', 'mounted knight cavalry'),
      c(GiWizardFace, 'GiWizardFace', 'wizard mage'),
      c(GiWitchFace, 'GiWitchFace', 'witch'),
      c(GiWomanElfFace, 'GiWomanElfFace', 'elf'),
      c(GiDwarfFace, 'GiDwarfFace', 'dwarf'),
      c(GiHoodedFigure, 'GiHoodedFigure', 'hooded figure rogue'),
      c(GiPirateCaptain, 'GiPirateCaptain', 'pirate captain'),
      c(GiVikingHead, 'GiVikingHead', 'viking warrior'),
      c(GiBowman, 'GiBowman', 'bowman archer ranger'),
      c(GiQueenCrown, 'GiQueenCrown', 'queen'),
      c(GiPerson, 'GiPerson', 'person character npc'),
      c(GiThreeFriends, 'GiThreeFriends', 'group party people'),
      c(GiFamilyTree, 'GiFamilyTree', 'family tree lineage'),
      c(GiDragonHead, 'GiDragonHead', 'dragon'),
      c(GiSpikedDragonHead, 'GiSpikedDragonHead', 'spiked dragon'),
      c(GiSeaDragon, 'GiSeaDragon', 'sea dragon serpent'),
      c(GiSkeleton, 'GiSkeleton', 'skeleton undead'),
      c(GiGhost, 'GiGhost', 'ghost spirit'),
      c(GiShamblingZombie, 'GiShamblingZombie', 'zombie undead'),
      c(GiVampireDracula, 'GiVampireDracula', 'vampire'),
      c(GiWerewolf, 'GiWerewolf', 'werewolf'),
      c(GiWolfHead, 'GiWolfHead', 'wolf'),
      c(GiOrcHead, 'GiOrcHead', 'orc'),
      c(GiGoblinHead, 'GiGoblinHead', 'goblin'),
      c(GiMinotaur, 'GiMinotaur', 'minotaur'),
      c(GiCyclops, 'GiCyclops', 'cyclops giant'),
      c(GiFairy, 'GiFairy', 'fairy fey'),
      c(GiUnicorn, 'GiUnicorn', 'unicorn'),
      c(GiGriffinSymbol, 'GiGriffinSymbol', 'griffin gryphon'),
      c(GiKrakenTentacle, 'GiKrakenTentacle', 'kraken tentacle'),
      c(GiSpiderFace, 'GiSpiderFace', 'spider'),
      c(GiRaven, 'GiRaven', 'raven crow'),
      c(GiOwl, 'GiOwl', 'owl'),
      c(GiEagleHead, 'GiEagleHead', 'eagle'),
      c(GiLion, 'GiLion', 'lion'),
      c(GiBearHead, 'GiBearHead', 'bear'),
      c(GiHorseHead, 'GiHorseHead', 'horse'),
      c(GiSnake, 'GiSnake', 'snake serpent'),
      c(GiDevilMask, 'GiDevilMask', 'devil demon'),
      c(GiAngelWings, 'GiAngelWings', 'angel wings'),
    ],
  },
  {
    category: 'Items',
    icons: [
      c(GiBroadsword, 'GiBroadsword', 'sword broadsword'),
      c(GiTwoHandedSword, 'GiTwoHandedSword', 'two handed sword greatsword'),
      c(GiBattleAxe, 'GiBattleAxe', 'battle axe'),
      c(GiWarhammer, 'GiWarhammer', 'warhammer hammer'),
      c(GiDaggers, 'GiDaggers', 'daggers knife'),
      c(GiBowArrow, 'GiBowArrow', 'bow arrow'),
      c(GiSpikedMace, 'GiSpikedMace', 'mace'),
      c(GiShield, 'GiShield', 'shield'),
      c(GiHelmet, 'GiHelmet', 'helmet'),
      c(GiBreastplate, 'GiBreastplate', 'breastplate armor'),
      c(GiPotionBall, 'GiPotionBall', 'potion'),
      c(GiMagicPotion, 'GiMagicPotion', 'magic potion elixir'),
      c(GiScrollUnfurled, 'GiScrollUnfurled', 'scroll document'),
      c(GiTiedScroll, 'GiTiedScroll', 'tied scroll letter'),
      c(GiSpellBook, 'GiSpellBook', 'spell book grimoire'),
      c(GiOpenBook, 'GiOpenBook', 'open book lore'),
      c(GiQuillInk, 'GiQuillInk', 'quill ink writing'),
      c(GiKey, 'GiKey', 'key'),
      c(GiCrown, 'GiCrown', 'crown king royalty'),
      c(GiRing, 'GiRing', 'ring'),
      c(GiGemPendant, 'GiGemPendant', 'amulet pendant necklace'),
      c(GiCrystalBall, 'GiCrystalBall', 'crystal ball divination'),
      c(GiWizardStaff, 'GiWizardStaff', 'wizard staff'),
      c(GiFairyWand, 'GiFairyWand', 'magic wand'),
      c(GiChest, 'GiChest', 'chest'),
      c(GiOpenTreasureChest, 'GiOpenTreasureChest', 'treasure chest loot'),
      c(GiCoins, 'GiCoins', 'coins gold money'),
      c(GiGoldBar, 'GiGoldBar', 'gold bar ingot'),
      c(GiHolyGrail, 'GiHolyGrail', 'holy grail'),
      c(GiLantern, 'GiLantern', 'lantern'),
      c(GiTorch, 'GiTorch', 'torch'),
      c(GiHourglass, 'GiHourglass', 'hourglass'),
      c(GiBackpack, 'GiBackpack', 'backpack bag'),
      c(GiBeerStein, 'GiBeerStein', 'beer ale drink'),
      c(GiSwordInStone, 'GiSwordInStone', 'sword in stone artifact'),
      c(GiLoveLetter, 'GiLoveLetter', 'letter envelope'),
    ],
  },
  {
    category: 'Travel & Maps',
    icons: [
      c(GiCompass, 'GiCompass', 'compass'),
      c(GiTreasureMap, 'GiTreasureMap', 'treasure map'),
      c(GiAnchor, 'GiAnchor', 'anchor'),
      c(GiShipWheel, 'GiShipWheel', 'ship wheel helm'),
      c(GiSailboat, 'GiSailboat', 'sailboat'),
      c(GiGalleon, 'GiGalleon', 'galleon ship'),
      c(GiShipWreck, 'GiShipWreck', 'shipwreck'),
      c(GiFishingBoat, 'GiFishingBoat', 'fishing boat'),
      c(GiRaft, 'GiRaft', 'raft'),
      c(GiHorseshoe, 'GiHorseshoe', 'horseshoe'),
      c(GiPathDistance, 'GiPathDistance', 'path distance route'),
      c(GiRoad, 'GiRoad', 'road'),
      c(GiMountainRoad, 'GiMountainRoad', 'mountain road pass'),
      c(GiCrossroad, 'GiCrossroad', 'crossroad'),
      c(GiDirectionSigns, 'GiDirectionSigns', 'signpost direction'),
      c(GiWoodenSign, 'GiWoodenSign', 'wooden sign'),
      c(GiFootprint, 'GiFootprint', 'footprint tracks'),
      c(GiTrail, 'GiTrail', 'trail'),
      c(GiCaravan, 'GiCaravan', 'caravan'),
      c(GiOldWagon, 'GiOldWagon', 'wagon cart'),
      c(GiSpyglass, 'GiSpyglass', 'spyglass telescope'),
      c(GiWorld, 'GiWorld', 'world globe'),
      c(GiPositionMarker, 'GiPositionMarker', 'marker pin location'),
      c(GiFlagObjective, 'GiFlagObjective', 'flag objective'),
      c(GiAirBalloon, 'GiAirBalloon', 'air balloon'),
      c(GiPortal, 'GiPortal', 'portal'),
    ],
  },
  {
    category: 'Factions & Symbols',
    icons: [
      c(GiKnightBanner, 'GiKnightBanner', 'knight banner'),
      c(GiVerticalBanner, 'GiVerticalBanner', 'banner'),
      c(GiPirateFlag, 'GiPirateFlag', 'pirate flag'),
      c(GiCrossedSwords, 'GiCrossedSwords', 'crossed swords war'),
      c(GiRuneStone, 'GiRuneStone', 'rune stone'),
      c(GiRuneSword, 'GiRuneSword', 'rune sword'),
      c(GiSkullCrossedBones, 'GiSkullCrossedBones', 'skull crossed bones'),
      c(GiCrownedSkull, 'GiCrownedSkull', 'crowned skull'),
      c(GiHolySymbol, 'GiHolySymbol', 'holy symbol'),
      c(GiAnkh, 'GiAnkh', 'ankh'),
      c(GiPentagramRose, 'GiPentagramRose', 'pentagram occult'),
      c(GiTriquetra, 'GiTriquetra', 'triquetra celtic'),
      c(GiYinYang, 'GiYinYang', 'yin yang balance'),
      c(GiEyeOfHorus, 'GiEyeOfHorus', 'eye of horus'),
      c(GiAllSeeingEye, 'GiAllSeeingEye', 'all seeing eye'),
      c(GiLaurelCrown, 'GiLaurelCrown', 'laurel crown'),
      c(GiCheckedShield, 'GiCheckedShield', 'checked shield heraldry'),
      c(GiGriffinShield, 'GiGriffinShield', 'griffin shield heraldry'),
      c(GiEagleEmblem, 'GiEagleEmblem', 'eagle emblem'),
      c(GiSwordsEmblem, 'GiSwordsEmblem', 'swords emblem'),
      c(GiFist, 'GiFist', 'fist rebellion'),
      c(GiScales, 'GiScales', 'scales justice law'),
      c(GiJerusalemCross, 'GiJerusalemCross', 'cross'),
      c(GiTrophy, 'GiTrophy', 'trophy'),
      c(GiMedal, 'GiMedal', 'medal honor'),
      c(GiThreeKeys, 'GiThreeKeys', 'three keys guild'),
    ],
  },
  {
    category: 'Events & Time',
    icons: [
      c(GiSandsOfTime, 'GiSandsOfTime', 'sands of time hourglass'),
      c(GiSundial, 'GiSundial', 'sundial'),
      c(GiCalendar, 'GiCalendar', 'calendar date'),
      c(GiSun, 'GiSun', 'sun day'),
      c(GiSunrise, 'GiSunrise', 'sunrise dawn'),
      c(GiSunset, 'GiSunset', 'sunset dusk'),
      c(GiMoon, 'GiMoon', 'moon night'),
      c(GiNightSky, 'GiNightSky', 'night sky stars'),
      c(GiEclipse, 'GiEclipse', 'eclipse'),
      c(GiCometSpark, 'GiCometSpark', 'comet'),
      c(GiLightningStorm, 'GiLightningStorm', 'storm lightning'),
      c(GiRaining, 'GiRaining', 'rain'),
      c(GiSnowing, 'GiSnowing', 'snow'),
      c(GiTornado, 'GiTornado', 'tornado'),
      c(GiFlood, 'GiFlood', 'flood'),
      c(GiEarthCrack, 'GiEarthCrack', 'earthquake'),
      c(GiFire, 'GiFire', 'fire'),
      c(GiExplosionRays, 'GiExplosionRays', 'explosion'),
      c(GiDuel, 'GiDuel', 'duel'),
      c(GiSwordClash, 'GiSwordClash', 'battle sword clash'),
      c(GiBloodySword, 'GiBloodySword', 'bloody sword massacre'),
      c(GiSiegeTower, 'GiSiegeTower', 'siege tower'),
      c(GiCatapult, 'GiCatapult', 'catapult siege'),
      c(GiPeaceDove, 'GiPeaceDove', 'peace dove treaty'),
      c(GiCoffin, 'GiCoffin', 'coffin death'),
      c(GiPlagueDoctorProfile, 'GiPlagueDoctorProfile', 'plague doctor'),
      c(GiPartyPopper, 'GiPartyPopper', 'celebration festival'),
      c(GiTrumpetFlag, 'GiTrumpetFlag', 'trumpet herald announcement'),
    ],
  },
]

/** id ("gi:GiCastle") → component, for every curated icon. */
const GI_MAP: Map<string, IconType> = new Map(
  ICON_CHOICES.flatMap((cat) => cat.icons.map((i) => [i.id, i.Icon] as const)),
)

/** Default icon for each page kind (all are in ICON_CHOICES). */
export const DEFAULT_KIND_ICONS: Record<PageKind, string> = {
  doc: 'gi:GiScrollUnfurled',
  map: 'gi:GiTreasureMap',
  timeline: 'gi:GiSandsOfTime',
}

/** True if the icon string is a Game Icons reference ("gi:..."). */
export function isGameIcon(icon: string | null | undefined): icon is string {
  return !!icon && icon.startsWith(GI_PREFIX)
}

/** Look up a curated icon component by id, or undefined. */
export function getIconComponent(icon: string): IconType | undefined {
  return GI_MAP.get(icon)
}

/**
 * Render an icon string. gi: names resolve via the curated static map
 * (unknown gi: names → null); anything else renders as text (emoji); falsy → null.
 * Game icons render as an inline SVG sized `size` px (default 1em) in currentColor.
 */
export function renderIcon(
  icon: string | null | undefined,
  opts?: { size?: number; className?: string },
): ReactNode {
  if (!icon) return null
  if (isGameIcon(icon)) {
    const Icon = GI_MAP.get(icon)
    if (!Icon) return null
    return (
      <Icon
        size={opts?.size ?? '1em'}
        className={opts?.className}
        aria-hidden="true"
        style={{ verticalAlign: '-0.125em', flexShrink: 0 }}
      />
    )
  }
  return opts?.className ? <span className={opts.className}>{icon}</span> : icon
}

/** The page's own icon, or the default for its kind. */
export function pageIconOf(page: Pick<Page, 'icon' | 'kind'>): string {
  return page.icon || DEFAULT_KIND_ICONS[page.kind] || DEFAULT_KIND_ICONS.doc
}

/**
 * Search curated icons by name (case-insensitive; every whitespace-separated
 * term must match). Empty query returns the first `limit` icons.
 */
export function searchIcons(query: string, limit = 60): IconChoice[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const out: IconChoice[] = []
  for (const cat of ICON_CHOICES) {
    for (const icon of cat.icons) {
      if (terms.every((t) => icon.name.includes(t) || icon.id.toLowerCase().includes(t))) {
        out.push(icon)
        if (out.length >= limit) return out
      }
    }
  }
  return out
}

/** Renders a page's icon (own icon or kind default). */
export function PageIcon(props: {
  page: Pick<Page, 'icon' | 'kind'>
  size?: number
  className?: string
}) {
  return <>{renderIcon(pageIconOf(props.page), { size: props.size, className: props.className })}</>
}
