import { renderIcon } from '../../lib/icons'

const REPO_URL = 'https://github.com/FieryBeaver/Archivarius'

export function AboutTab() {
  return (
    <div className="wks-stack">
      <div className="wks-about-head">
        <span className="wks-about-glyph">{renderIcon('gi:GiTreasureMap', { size: 32 })}</span>
        <div>
          <div className="wks-about-name">Archivarius</div>
          <div className="wks-hint">
            A quiet place to build worlds: pages in a tree, maps with pins, timelines — shared with your table.
          </div>
        </div>
      </div>

      <div className="wks-field">
        <div className="wks-label">Credits</div>
        <ul className="wks-credits">
          <li>
            Icons: Game Icons (
            <a href="https://game-icons.net" target="_blank" rel="noopener noreferrer">game-icons.net</a>
            ),{' '}
            <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener noreferrer">CC BY 3.0</a>
          </li>
          <li>Built with React, TipTap, Leaflet, Supabase</li>
        </ul>
      </div>

      <div className="wks-field">
        <div className="wks-label">Source</div>
        <a className="wks-link" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          github.com/FieryBeaver/Archivarius
        </a>
      </div>
    </div>
  )
}
