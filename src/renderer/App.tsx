import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { CommandPalette } from './components/CommandPalette';
import { ImportFilmDialog } from './components/ImportFilmDialog';
import { Icon } from './components/icons';
import { useAppState } from './lib/appState';
import { isEditableTarget, requestSearchFocus } from './lib/shortcuts';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { FilmDetailPage } from './pages/FilmDetailPage';
import { CollectionsPage } from './pages/CollectionsPage';
import { CollectionDetailPage } from './pages/CollectionDetailPage';
import { WatchlistPage } from './pages/WatchlistPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const { loading, error, refreshInfo } = useAppState();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();

      if (key === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      // Ctrl+F / Ctrl+I are only hijacked outside text fields so typing is untouched.
      if (isEditableTarget(event.target)) return;
      if (key === 'f') {
        event.preventDefault();
        requestSearchFocus();
        navigate('/library');
        return;
      }
      if (key === 'i') {
        event.preventDefault();
        setImportOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  if (loading) {
    return (
      <div className="boot-screen">
        <span className="brand-mark" style={{ width: 40, height: 40 }}>
          <Icon name="film" size={20} />
        </span>
        <div className="boot-title serif">My Cinema</div>
        <div className="row gap-2 dim" style={{ fontSize: 13 }}>
          <span className="spinner" /> 正在打开本地收藏库…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="boot-screen">
        <span className="state-icon" style={{ color: 'var(--danger)' }}>
          <Icon name="alert" size={22} />
        </span>
        <div className="boot-title">无法启动 My Cinema</div>
        <p className="muted" style={{ maxWidth: 460, textAlign: 'center', lineHeight: 1.7 }}>
          {error}
        </p>
        <div className="row gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => void refreshInfo()}>
            <Icon name="refresh" size={15} />
            重试
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void window.cinema.app.openFolder('data')}
          >
            <Icon name="folder" size={15} />
            打开数据目录
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route
          element={
            <AppShell
              onOpenPalette={() => setPaletteOpen(true)}
              onOpenImport={() => setImportOpen(true)}
            />
          }
        >
          <Route path="/" element={<HomePage onOpenImport={() => setImportOpen(true)} />} />
          <Route path="/library" element={<LibraryPage onOpenImport={() => setImportOpen(true)} />} />
          <Route path="/film/:filmId" element={<FilmDetailPage />} />
          <Route
            path="/collections"
            element={<CollectionsPage onOpenImport={() => setImportOpen(true)} />}
          />
          <Route path="/collections/:collectionId" element={<CollectionDetailPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenImport={() => setImportOpen(true)}
      />
      <ImportFilmDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}
