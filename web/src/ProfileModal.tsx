// FUTUREHAT — Profile settings modal

import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabase';
import { updateMyProfile, uploadAvatar } from '@shared/api';
import './ProfileModal.css';

interface Props {
  onClose: () => void;
}

export function ProfileModal({ onClose }: Props) {
  const { profile, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [username, setUsername] = useState(profile?.username || '');
  const [about, setAbout] = useState(profile?.about || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Build the preview URL once per selected file and revoke it on change/unmount
  // so we don't leak a new blob URL on every render.
  const avatarPreview = useMemo(
    () => (avatarFile ? URL.createObjectURL(avatarFile) : null),
    [avatarFile],
  );
  useEffect(() => {
    return () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); };
  }, [avatarPreview]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;

    setSaving(true);
    setError('');

    try {
      let avatarUrl = profile.avatar_url;

      // Upload avatar if changed
      if (avatarFile) {
        const { url, error: uploadErr } = await uploadAvatar(supabase, profile.id, avatarFile);
        if (uploadErr) throw uploadErr;
        avatarUrl = url;
      }

      // Update profile
      const { error: updateErr } = await updateMyProfile(supabase, {
        display_name: displayName.trim() || null,
        username: username.trim() || null,
        about: about.trim() || null,
        avatar_url: avatarUrl,
      });
      if (updateErr) throw updateErr;

      await refreshProfile(); // re-pull profile into context without a full reload
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Profile Settings</h2>
          <button onClick={onClose} className="close-btn">✕</button>
        </div>

        <form onSubmit={handleSave} className="profile-form">
          <div className="avatar-upload">
            <div className="avatar-preview">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Preview" />
              ) : profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="Avatar" />
              ) : (
                <div className="avatar-placeholder">{displayName?.[0] || '?'}</div>
              )}
            </div>
            <label className="upload-label">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
                style={{ display: 'none' }}
              />
              Change Avatar
            </label>
          </div>

          <label>
            Display Name
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
            />
          </label>

          <label>
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@username"
            />
          </label>

          <label>
            About
            <textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="Hey there! I am using FUTUREHAT."
              rows={3}
            />
          </label>

          {error && <div className="error-msg">{error}</div>}

          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className="primary">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
