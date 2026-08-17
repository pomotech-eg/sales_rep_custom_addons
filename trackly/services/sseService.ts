/**
 * SSE Service for Trackly
 *
 * Manages a persistent Server-Sent Events connection to the Odoo SSE endpoint
 * for real-time sync notifications. Falls back to polling when unavailable.
 *
 * Usage:
 *   import { sseService } from './sseService';
 *   sseService.connect(token, onSyncRequired);
 *   sseService.disconnect();
 */

import { AppState, AppStateStatus, Platform } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { IEventSource, EventSourceListener } from './eventSourceWrapper.types';
import createEventSource from './eventSourceWrapper';
import apiClient from './apiClient';
import { useAuthStore } from '@/store/useAuthStore';

// ── Configuration ─────────────────────────────────────────────────────
const RECONNECT_BASE_DELAY = 5_000;      // 5s initial reconnect delay (increased for stability)
const RECONNECT_MAX_DELAY = 60_000;      // 60s max reconnect delay
const SYNC_COOLDOWN = 5_000;             // Ignore sync_required within 5s of last trigger

type SyncCallback = () => void;
type StatusCallback = (status: SSEStatus) => void;

export type SSEStatus = 'disconnected' | 'connecting' | 'connected' | 'offline';

type CustomSSEEvents = "connected" | "sync_required" | "force_logout";

class SSEService {
    private eventSource: IEventSource | null = null;
    private token: string | null = null;
    private onSyncRequired: SyncCallback | null = null;
    private onStatusChange: StatusCallback | null = null;

    private _status: SSEStatus = 'disconnected';
    private reconnectAttempts = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private isManualDisconnect = false;
    private isOnline = true;
    private lastSyncTrigger = 0;
    private appStateSubscription: any = null;
    private netInfoSubscription: (() => void) | null = null;
    private backgroundTimer: ReturnType<typeof setTimeout> | null = null;

    get status(): SSEStatus {
        return this._status;
    }

    private setStatus(status: SSEStatus) {
        if (this._status === status) return;
        this._status = status;
        this.onStatusChange?.(status);
    }

    /**
     * Build the SSE URL from the existing BASE_URL.
     * Token is passed as a query parameter since EventSource
     * doesn't support custom headers.
     */
    private getSseUrl(): string {
        const token = useAuthStore.getState().token;
        const baseURL = apiClient.defaults.baseURL || '';
        const cleanBaseUrl = baseURL.replace(/\/+$/, '');
        return `${cleanBaseUrl}/api/mobile/sse?token=${token}`;
    }

    /**
     * Connect to the Odoo SSE endpoint.
     */
    connect(token: string, onSyncRequired: SyncCallback, onStatusChange?: StatusCallback) {
        this.token = token;
        this.onSyncRequired = onSyncRequired;
        this.onStatusChange = onStatusChange || null;
        this.isManualDisconnect = false;
        this.reconnectAttempts = 0;

        // Listen for network changes
        if (!this.netInfoSubscription) {
            this.netInfoSubscription = NetInfo.addEventListener((state: NetInfoState) => {
                const wasOnline = this.isOnline;
                this.isOnline = !!state.isConnected;

                if (!wasOnline && this.isOnline) {
                    console.log('[SSE] Network restored — reconnecting');
                    this.setStatus('connecting');
                    this.reconnectAttempts = 0;
                    this.attemptConnect();
                } else if (wasOnline && !this.isOnline) {
                    console.log('[SSE] Network lost');
                    this.setStatus('offline');
                    this.closeConnection();
                }
            });
        }

        // Listen for app state changes
        if (!this.appStateSubscription) {
            this.appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
                if (state === 'active') {
                    if (this.backgroundTimer) {
                        console.log('[SSE] App active (restored within grace period)');
                        clearTimeout(this.backgroundTimer);
                        this.backgroundTimer = null;
                    }
                    if (this._status !== 'connected' && this.isOnline && !this.isManualDisconnect) {
                        console.log('[SSE] App active — reconnecting');
                        this.reconnectAttempts = 0;
                        this.attemptConnect();
                    }
                } else if (state === 'background') {
                    console.log('[SSE] App backgrounded — starting 5s grace period');
                    this.backgroundTimer = setTimeout(() => {
                        console.log('[SSE] Background grace period expired — closing connection');
                        this.closeConnection();
                        this.backgroundTimer = null;
                    }, 5000);
                }
            });
        }

        this.attemptConnect();
    }

    /**
     * Cleanly disconnect and stop all listeners.
     */
    disconnect() {
        this.isManualDisconnect = true;
        this.clearTimers();
        this.closeConnection();
        this.setStatus('disconnected');

        if (this.netInfoSubscription) {
            this.netInfoSubscription();
            this.netInfoSubscription = null;
        }
        if (this.appStateSubscription) {
            this.appStateSubscription.remove();
            this.appStateSubscription = null;
        }
    }

    /**
     * Open an EventSource connection.
     */
    private attemptConnect() {
        if (!this.isOnline || this.isManualDisconnect) return;
        if (this.eventSource) return; // Already connected or connecting

        this.clearTimers();
        this.setStatus('connecting');

        const url = this.getSseUrl();
        console.log(`[SSE] Connecting to ${url} (attempt ${this.reconnectAttempts + 1})`);

        try {
            this.eventSource = createEventSource(url, {
                pollingInterval: 0, // Enforces EventSource mode (not polling)
            });
        } catch (e) {
            console.log('[SSE] Failed to create EventSource:', e);
            this.scheduleReconnect();
            return;
        }

        // ── Connected event from server ───────────────────────────
        (this.eventSource as any).addEventListener('connected', ((event: any) => {
            try {
                const data = JSON.parse(event.data);
                // console.log(`[SSE] ✅ Connected as sales_rep ${data.sales_rep_id}`);
            } catch { }
            this.reconnectAttempts = 0;
            this.setStatus('connected');

            // Immediately sync on connect to push pending data
            console.log('[SSE] Triggering immediate sync on connect');
            this.lastSyncTrigger = Date.now();
            this.onSyncRequired?.();
        }) as EventSourceListener);

        // ── Sync required event ───────────────────────────────────
        (this.eventSource as any).addEventListener('sync_required', ((event: any) => {
            // Debounce: ignore if we just triggered a sync
            if (Date.now() - this.lastSyncTrigger < SYNC_COOLDOWN) {
                console.log('[SSE] 📥 Sync required (ignored — cooldown active)');
                return;
            }
            try {
                const data = JSON.parse(event.data);
                console.log(`[SSE] 📥 Sync required (reason: ${data.reason})`);
            } catch { }
            this.lastSyncTrigger = Date.now();
            this.onSyncRequired?.();
        }) as EventSourceListener);

        // ── Force logout event ────────────────────────────────────
        (this.eventSource as any).addEventListener('force_logout', ((event: any) => {
            console.log('[SSE] ⚠️ Force logout received — session invalidated elsewhere');
            try {
                const data = JSON.parse(event.data);
                console.log(`[SSE] Force logout reason: ${data.reason}`);
            } catch { }

            // Trigger immediate force logout
            useAuthStore.getState().logout(true).catch(err => {
                console.error('[SSE] Failed to execute force logout:', err);
            });
        }) as EventSourceListener);

        // ── Error handling ────────────────────────────────────────
        (this.eventSource as any).addEventListener("error", (event: any) => {
            console.log('[SSE] Connection error detail:', JSON.stringify(event));
            this.closeConnection();

            if (!this.isManualDisconnect && this.isOnline) {
                this.setStatus('disconnected');
                this.scheduleReconnect();
            }
        });
    }

    /**
     * Schedule a reconnect with exponential backoff.
     */
    private scheduleReconnect() {
        if (this.isManualDisconnect || !this.isOnline) return;

        const delay = Math.min(
            RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts),
            RECONNECT_MAX_DELAY
        );
        this.reconnectAttempts++;

        console.log(`[SSE] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);

        this.reconnectTimer = setTimeout(() => {
            this.attemptConnect();
        }, delay);
    }

    /**
     * Close the EventSource without triggering reconnect.
     */
    private closeConnection() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }

    private clearTimers() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}

// Singleton instance
export const sseService = new SSEService();
