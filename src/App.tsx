import { NavLink, Route, Routes } from 'react-router-dom';

import { WalletBar } from './components/WalletBar';
import { AllDropsPage } from './pages/AllDropsPage';
import { DropPage } from './pages/DropPage';
import { HomePage } from './pages/HomePage';
import { SnapPage } from './pages/SnapPage';

function NotFound() {
  return (
    <section className="card">
      <h2>Not found</h2>
      <p className="muted">This route does not exist.</p>
    </section>
  );
}

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <div className="container stack headerStack">
          <div className="row between center headerTop">
            <div className="brand">
              <div className="brandTitle">DeadDrop Protocol (DDRP)</div>
              <div className="brandSub">Encrypted on-chain message drops • nudging ERC-5630 adoption</div>
            </div>
            <WalletBar />
          </div>
          <nav className="nav">
            <NavLink className={({ isActive }) => (isActive ? 'navLink active' : 'navLink')} to="/" end>
              Home
            </NavLink>
            <NavLink className={({ isActive }) => (isActive ? 'navLink active' : 'navLink')} to="/drops">
              Drops
            </NavLink>
            <NavLink className={({ isActive }) => (isActive ? 'navLink active' : 'navLink')} to="/snap">
              Snap
            </NavLink>
            <a className="navLink" href="https://eips.ethereum.org/EIPS/eip-5630" target="_blank" rel="noreferrer">
              ERC-5630
            </a>
            <a
              className="navLink iconLink"
              href="https://github.com/pierce403/ddrp"
              target="_blank"
              rel="noreferrer"
              aria-label="DDRP GitHub repository"
              title="GitHub"
            >
              <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M8 0C3.58 0 0 3.64 0 8.13c0 3.59 2.29 6.64 5.47 7.72.4.08.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.38-2.53-.5-2.69-.96-.09-.23-.48-.96-.82-1.15-.28-.15-.68-.52-.01-.53.63-.01 1.08.59 1.23.84.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.21-3.64-.91-3.64-4.03 0-.89.31-1.62.82-2.19-.08-.21-.36-1.05.08-2.18 0 0 .67-.22 2.2.84.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.06 2.2-.84 2.2-.84.44 1.13.16 1.97.08 2.18.51.57.82 1.3.82 2.19 0 3.13-1.87 3.82-3.65 4.03.29.25.54.74.54 1.5 0 1.08-.01 1.95-.01 2.22 0 .21.15.47.55.38C13.71 14.77 16 11.72 16 8.13 16 3.64 12.42 0 8 0z"
                />
              </svg>
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="container main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/drops" element={<AllDropsPage />} />
          <Route path="/drops/:id" element={<DropPage />} />
          <Route path="/snap" element={<SnapPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <footer className="footer">
        <div className="container">
          <div className="muted">
            DDRP is a demo. Do not paste real private keys. Prefer wallet-assisted ECDH (ERC-5630) when available.
          </div>
        </div>
      </footer>
    </div>
  );
}
