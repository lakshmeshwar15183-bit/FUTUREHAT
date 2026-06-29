// FUTUREHAT — Status/Stories viewer

import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabase';
import { getActiveStatuses, createStatus } from '@shared/api';
import type { Status } from '@shared/types';
import './StatusView.css';

interface Props {
  onClose: () => void;
}

export function StatusView({ onClose }: Props) {
  const { profile } = useAuth();
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [creating, setCreating] = useState(false);
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);

  useEffect(() => {
    loadStatuses();
  }, []);

  async function loadStatuses() {
    const data = await getActiveStatuses(supabase);
    setStatuses(data);
  }

  async function handleCreateText() {
    if (!text.trim() || creating) return;
    setCreating(true);
    try {
      await createStatus(supabase, 'text', text.trim(), undefined, '#667eea');
      setText('');
      loadStatuses();
    } catch (err: any) {
      alert(err.message || 'Failed to create status');
    } finally {
      setCreating(false);
    }
  }

  const MAX_STATUS_BYTES = 10 * 1024 * 1024; // 10 MB

  async function handleCreateImage() {
    if (!imageFile || !profile || creating) return;
    if (!imageFile.type.startsWith('image/')) {
      alert('Please choose an image file.');
      return;
    }
    if (imageFile.size > MAX_STATUS_BYTES) {
      alert('Image is too large. Please choose a file under 10 MB.');
      return;
    }
    setCreating(true);
    try {
      // Upload to status bucket
      const ext = imageFile.name.split('.').pop() || 'jpg';
      const path = `${profile.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('status').upload(path, imageFile);
      if (uploadErr) throw uploadErr;

      const { data } = supabase.storage.from('status').getPublicUrl(path);
      await createStatus(supabase, 'image', '', data.publicUrl);
      setImageFile(null);
      loadStatuses();
    } catch (err: any) {
      alert(err.message || 'Failed to upload status');
    } finally {
      setCreating(false);
    }
  }

  // Group by user
  const grouped = statuses.reduce((acc, s) => {
    if (!acc[s.user_id]) acc[s.user_id] = [];
    acc[s.user_id].push(s);
    return acc;
  }, {} as Record<string, Status[]>);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="status-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Status Updates</h2>
          <button onClick={onClose} className="close-btn">✕</button>
        </div>

        <div className="status-create">
          <textarea
            placeholder="Share a text status..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            disabled={creating}
          />
          <button onClick={handleCreateText} disabled={!text.trim() || creating}>
            Post Text
          </button>

          <label className="image-upload-btn">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setImageFile(e.target.files?.[0] || null)}
              style={{ display: 'none' }}
            />
            {imageFile ? imageFile.name : '📷 Upload Image'}
          </label>
          {imageFile && (
            <button onClick={handleCreateImage} disabled={creating} className="upload-btn">
              {creating ? 'Uploading...' : 'Post Image'}
            </button>
          )}
        </div>

        <div className="status-list">
          {Object.entries(grouped).map(([userId, userStatuses]) => {
            const latest = userStatuses[0];
            return (
              <div key={userId} className="status-item">
                <div className="status-header">
                  <div className="avatar">{latest.user_id[0]}</div>
                  <div className="status-info">
                    <div className="status-user">{userId === profile?.id ? 'You' : 'User'}</div>
                    <div className="status-time">
                      {new Date(latest.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="status-content">
                  {latest.type === 'text' && (
                    <div className="status-text" style={{ background: latest.background || '#667eea' }}>
                      {latest.content}
                    </div>
                  )}
                  {latest.type === 'image' && latest.media_url && (
                    <img src={latest.media_url} alt="Status" className="status-image" />
                  )}
                </div>
              </div>
            );
          })}
          {statuses.length === 0 && (
            <div className="no-statuses">No active statuses. Create one to share!</div>
          )}
        </div>
      </div>
    </div>
  );
}
