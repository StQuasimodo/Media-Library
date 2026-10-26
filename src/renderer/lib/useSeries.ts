import { useEffect, useState } from 'react';
import type { CollectionEntry } from '@shared/types';
import { api } from './api';
import { useAppState } from './appState';

/** Enrich old movie records in the background; never delay rendering the wall. */
export function useResolveSeries(entries:CollectionEntry[]) {
  const {info,invalidate}=useAppState();const [pending,setPending]=useState(false);
  const signature=entries.filter(entry=>entry.film.mediaType==='movie' && entry.film.metadataSource==='tmdb' && entry.film.series===undefined).map(entry=>entry.id).sort().join('|');
  useEffect(()=>{
    if(!signature || !info?.hasMetadataApiKey) {setPending(false);return;}
    let live=true;setPending(true);
    void api.metadata.resolveSeries().then(result=>{if(live && result.updated)invalidate();})
      .catch(()=>{/* Local title and season grouping remains available offline. */})
      .finally(()=>{if(live)setPending(false);});
    return()=>{live=false;};
  },[signature,info?.hasMetadataApiKey]);
  return pending;
}
