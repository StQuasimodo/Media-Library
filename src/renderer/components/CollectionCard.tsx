import { Link } from 'react-router-dom';
import type { FilmCollection } from '@shared/types';
import { Icon } from './icons';
import { imageUrl } from '../lib/format';

export function CollectionCard({
  collection,
  onEdit,
  onDelete,
}: {
  collection: FilmCollection;
  onEdit?: (collection: FilmCollection) => void;
  onDelete?: (collection: FilmCollection) => void;
}) {
  const posters = collection.previewPosterPaths
    .map((path) => imageUrl(path))
    .filter((url): url is string => Boolean(url))
    .slice(0, 4);

  return (
    <Link to={`/collections/${collection.id}`} className="collection-card">
      <div className="collection-cover">
        {posters.length > 0 ? (
          posters.map((url, index) => <img key={`${url}-${index}`} src={url} alt="" loading="lazy" />)
        ) : (
          <div className="collection-cover-placeholder">
            {collection.name.slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>
      <div className="collection-body">
        <div className="collection-name">{collection.name}</div>
        <div className="collection-desc">{collection.description || '尚未填写专题描述'}</div>
        <div className="collection-count">{collection.filmCount} 部作品</div>
      </div>

      {onEdit || onDelete ? (
        <div className="collection-actions">
          {onEdit ? (
            <button
              type="button"
              className="btn btn-icon"
              aria-label={`编辑专题 ${collection.name}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onEdit(collection);
              }}
            >
              <Icon name="edit" size={14} />
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              className="btn btn-icon"
              aria-label={`删除专题 ${collection.name}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDelete(collection);
              }}
            >
              <Icon name="trash" size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}
