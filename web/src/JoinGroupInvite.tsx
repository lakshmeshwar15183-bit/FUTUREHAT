// Lumixo — join a group via invite token (/invite/g/:token).
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { joinByInvite } from '@shared/groupsApi';
import { getCurrentUser } from '@shared/api';

interface Props {
  token: string;
  onJoined: (conversationId: string) => void;
  onNeedAuth: () => void;
  onClose: () => void;
}

export function JoinGroupInvite({ token, onJoined, onNeedAuth, onClose }: Props) {
  const [status, setStatus] = useState<'working' | 'joined' | 'pending' | 'error'>('working');
  const [message, setMessage] = useState('Joining group…');

  useEffect(() => {
    let active = true;
    (async () => {
      const user = await getCurrentUser(supabase);
      if (!user) {
        onNeedAuth();
        return;
      }
      const res = await joinByInvite(supabase, token);
      if (!active) return;
      if (res.error) {
        setStatus('error');
        setMessage(res.error.message);
        return;
      }
      if (res.status === 'pending') {
        setStatus('pending');
        setMessage('Join request sent. An admin must approve you.');
        return;
      }
      if (res.targetType === 'conversation' && res.targetId) {
        setStatus('joined');
        setMessage('Joined the group!');
        setTimeout(() => onJoined(res.targetId!), 600);
        return;
      }
      setStatus('error');
      setMessage('Could not join this invite.');
    })();
    return () => {
      active = false;
    };
  }, [token, onJoined, onNeedAuth]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ padding: 32, textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>Group invite</h2>
        <p style={{ opacity: 0.8 }}>{message}</p>
        {status === 'error' || status === 'pending' ? (
          <button type="button" className="primary" onClick={onClose} style={{ marginTop: 16 }}>
            Close
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default JoinGroupInvite;
