import { NavLink, Route, Routes } from 'react-router-dom';

import { WalletBar } from './components/WalletBar';
import { AllDropsPage } from './pages/AllDropsPage';
import { DropPage } from './pages/DropPage';
import { HomePage } from './pages/HomePage';

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
        <div className="container stack">
          <div className="row between center">
            <div className="brand">
              <div className="brandTitle">DeadDrop Protocol (DDRP)</div>
              <div className="brandSub">Encrypted on-chain message drops • nudging EIP-5630 adoption</div>
            </div>
            <nav className="nav">
              <NavLink className={({ isActive }) => (isActive ? 'navLink active' : 'navLink')} to="/" end>
                Home
              </NavLink>
              <NavLink className={({ isActive }) => (isActive ? 'navLink active' : 'navLink')} to="/drops">
                Drops
              </NavLink>
              <a className="navLink" href="https://eips.ethereum.org/EIPS/eip-5630" target="_blank" rel="noreferrer">
                EIP-5630
              </a>
            </nav>
          </div>

          <WalletBar />
        </div>
      </header>

      <main className="container main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/drops" element={<AllDropsPage />} />
          <Route path="/drops/:id" element={<DropPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <footer className="footer">
        <div className="container">
          <div className="muted">
            DDRP is a demo. Do not paste real private keys. Prefer wallet-assisted ECDH (EIP-5630) when available.
          </div>
        </div>
      </footer>
    </div>
  );
}
