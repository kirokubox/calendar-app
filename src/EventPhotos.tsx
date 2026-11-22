import { useEffect, useState } from "react";
import { getPhoto } from "./storage";
import type { StoredPhoto } from "./types";

function PhotoTile({ id, draft, onRemove }: { id: string; draft?: StoredPhoto; onRemove?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [extension, setExtension] = useState("webp");
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    void (draft ? Promise.resolve(draft) : getPhoto(id)).then((photo) => {
      if (!alive || !photo) return;
      objectUrl = URL.createObjectURL(photo.thumb ?? photo.blob);
      setUrl(objectUrl);
    });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, draft]);
  useEffect(() => {
    if (!open) { setFullUrl(null); return; }
    let alive = true;
    let objectUrl: string | null = null;
    void (draft ? Promise.resolve(draft) : getPhoto(id)).then((photo) => {
      if (!alive || !photo) return;
      objectUrl = URL.createObjectURL(photo.blob);
      setExtension(photo.mimeType === "image/png" ? "png" : photo.mimeType === "image/webp" ? "webp" : "jpg");
      setFullUrl(objectUrl);
    });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, draft, open]);
  return <div className="event-photo-tile">
    <button type="button" onClick={() => setOpen(true)} aria-label="写真を拡大">{url ? <img src={url} alt="" /> : "写真を読み込めません"}</button>
    {onRemove && <button type="button" className="event-photo-remove" onClick={onRemove} aria-label="写真を外す">×</button>}
    {open && <div className="event-photo-viewer" role="dialog" aria-modal="true" aria-label="写真を拡大" onClick={(e) => e.stopPropagation()}>
      {fullUrl && <img src={fullUrl} alt="" />}
      <div className="inline-actions">
        {fullUrl && <a className="secondary-btn" href={fullUrl} download={`calendar-photo-${id}.${extension}`}>写真を保存</a>}
        <button type="button" className="secondary-btn" onClick={() => setOpen(false)}>閉じる</button>
      </div>
    </div>}
  </div>;
}

export default function EventPhotos({ ids, drafts = [], onRemove }: { ids: string[]; drafts?: StoredPhoto[]; onRemove?: (id: string) => void }) {
  if (ids.length === 0) return null;
  return <div className="event-photo-grid">{ids.map((id) => <PhotoTile key={id} id={id} draft={drafts.find((p) => p.id === id)} onRemove={onRemove ? () => onRemove(id) : undefined} />)}</div>;
}
