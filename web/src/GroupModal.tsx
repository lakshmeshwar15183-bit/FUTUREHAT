// Lumixo — Create group chat modal (full WhatsApp-style flow)

import { useState, useEffect, type FormEvent } from 'react';
import { supabase } from './supabase';
import { searchProfiles, createGroupConversation } from '@shared/api';
import { sendPush } from '@shared/pushApi';
import type { Profile } from '@shared/types';
import { useEscapeToClose } from './useEscapeToClose';
import './GroupModal.css';

interface Props {
  onClose: () => void;
  onCreated: (conversationId?: string) => void;
}

export function GroupModal({ onClose, onCreated }: Props) {
  useEscapeToClose(onClose);
  const [step, setStep] = useState<'members' | 'details' | 'success'>('members');
  const [groupName, setGroupName] = useState('');
  const [description, setDescription] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Profile[]>([]);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  function pickIcon(file: File | null) {
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconFile(file);
    setIconPreview(file ? URL.createObjectURL(file) : '');
  }

  useEffect(() => {
    return () => {
      if (iconPreview) URL.revokeObjectURL(iconPreview);
    };
  }, [iconPreview]);

  useEffect(() => {
    if (searchQuery.trim()) {
      const timer = setTimeout(() => {
        searchProfiles(supabase, searchQuery).then(setSearchResults);
      }, 300);
      return () => clearTimeout(timer);
    }
    setSearchResults([]);
  }, [searchQuery]);

  function toggleUser(user: Profile) {
    if (selectedUsers.find((u) => u.id === user.id)) {
      setSelectedUsers((prev) => prev.filter((u) => u.id !== user.id));
    } else {
      setSelectedUsers((prev) => [...prev, user]);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!groupName.trim() || selectedUsers.length === 0) return;

    setCreating(true);
    setError('');

    try {
      let avatarUrl: string | null = null;
      if (iconFile) {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) throw new Error('Not authenticated');
        const ext = (iconFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${uid}/group-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, iconFile, { upsert: true, contentType: iconFile.type || 'image/jpeg' });
        if (upErr) throw upErr;
        avatarUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      }

      const { conversationId, error: err } = await createGroupConversation(
        supabase,
        groupName.trim(),
        selectedUsers.map((u) => u.id),
        avatarUrl,
        description.trim() || null,
      );
      if (err) throw err;
      if (!conversationId) throw new Error('No conversation ID returned');

      void sendPush(supabase, {
        conversationId,
        kind: 'group',
        title: groupName.trim(),
        body: 'You were added to a group',
        data: { type: 'added_to_group' },
      });

      setStep('success');
      setTimeout(() => {
        onCreated(conversationId);
        onClose();
      }, 700);
    } catch (err: any) {
      setError(err.message || 'Failed to create group');
      setCreating(false);
    }
  }

  if (step === 'success') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card group-success" onClick={(e) => e.stopPropagation()}>
          <div className="group-success-check">✓</div>
          <h2>Group created</h2>
          <p>{groupName}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{step === 'members' ? 'Add members' : 'New group'}</h2>
          <button onClick={onClose} className="close-btn" aria-label="Close">
            ✕
          </button>
        </div>

        {step === 'members' ? (
          <div className="group-form">
            <label>
              Search contacts
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search users…"
                autoFocus
              />
            </label>

            {selectedUsers.length > 0 && (
              <div className="selected-users">
                {selectedUsers.map((u) => (
                  <div key={u.id} className="selected-user">
                    {u.display_name || 'Unknown'}
                    <button
                      type="button"
                      onClick={() => toggleUser(u)}
                      aria-label={`Remove ${u.display_name || 'user'}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="user-search-results">
              {searchResults.map((u) => {
                const isSelected = selectedUsers.find((s) => s.id === u.id);
                return (
                  <div
                    key={u.id}
                    className={`user-result ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleUser(u)}
                  >
                    <div className="avatar">{u.display_name?.[0] || '?'}</div>
                    <div className="user-info">
                      <div className="user-name">{u.display_name || 'Unknown'}</div>
                      <div className="user-username">@{u.username || u.id.slice(0, 8)}</div>
                    </div>
                    {isSelected && <div className="check-mark">✓</div>}
                  </div>
                );
              })}
            </div>

            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={selectedUsers.length === 0}
                onClick={() => setStep('details')}
              >
                Next
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="group-form">
            <label className="group-icon-picker">
              <div className="group-icon-preview">
                {iconPreview ? <img src={iconPreview} alt="Group icon" /> : <span>📷</span>}
              </div>
              <span className="group-icon-hint">
                {iconFile ? 'Change icon' : 'Add group icon (optional)'}
              </span>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => pickIcon(e.target.files?.[0] || null)}
              />
            </label>

            <label>
              Group Name
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name"
                required
                maxLength={100}
                autoFocus
              />
            </label>

            <label>
              Description (optional)
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this group about?"
                maxLength={500}
                rows={3}
                className="group-desc"
              />
            </label>

            <p className="group-participants-hint">
              {selectedUsers.length} participant{selectedUsers.length === 1 ? '' : 's'}:{' '}
              {selectedUsers.map((u) => u.display_name || 'User').join(', ')}
            </p>

            {error && <div className="error-msg">{error}</div>}

            <div className="modal-actions">
              <button type="button" onClick={() => setStep('members')} disabled={creating}>
                Back
              </button>
              <button
                type="submit"
                disabled={creating || !groupName.trim() || selectedUsers.length === 0}
                className="primary"
              >
                {creating ? 'Creating…' : 'Create Group'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
