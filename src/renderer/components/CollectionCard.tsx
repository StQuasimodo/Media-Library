import { Link } from 'react-router-dom';
import type { FilmCollection } from '@shared/types';
import { Icon } from './icons';
import { PosterImage } from './PosterImage';

export function CollectionCard({
  collection,
  onEdit,
  onDelete,
}: {
  collection: FilmCollection;
  onEdit?: (collection: FilmCollection) => void;
  onDelete?: (collection: FilmCollection) => void;
}) {
  const posters = collection.previewPosterPaths.filter(Boolean).slice(0, 4);

  return (
    <article className="collection-card">
      <Link to={`/collections/${collection.id}`} className="collection-link">
        <div className="collection-cover">
          {posters.length > 0 ? (
            posters.map((path, index) => <span className="collection-cover-image" key={`${path}-${index}`}><PosterImage film={{ posterPath: path, title: collection.name, year: null }} /></span>)
          ) : (
            <div className="collection-cover-placeholder">
              <span className="collection-cover-empty-label">私人选辑</span>
              <span>{collection.name}</span>
            </div>
          )}
        </div>
        <div className="collection-body">
          <div className="collection-name">{collection.name}</div>
          <div className="collection-desc">{collection.description || '尚未填写专题描述'}</div>
          <div className="collection-count">{collection.filmCount} 部作品</div>
        </div>
      </Link>
      {onEdit || onDelete ? (
        <div className="collection-actions">
          {onEdit ? (
            <button
              type="button"
              className="btn btn-icon"
              aria-label={`编辑专题 ${collection.name}`}
              onClick={() => onEdit(collection)}
            >
              <Icon name="edit" size={14} />
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              className="btn btn-icon"
              aria-label={`删除专题 ${collection.name}`}
              onClick={() => onDelete(collection)}
            >
              <Icon name="trash" size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
