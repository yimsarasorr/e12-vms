import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';
import { Router } from '@angular/router';
import * as QRCode from 'qrcode';

interface TicketPass {
  id: string;
  doorId: string;
  qrValue: string;
  qrPayload: string;
  qrImageDataUrl: string;
  roomName: string;
  floorName: string;
  buildingId: string;
  buildingName: string;
  validUntil: string | null;
  grantedAt: string | null;
}

@Component({
  selector: 'app-tickets',
  templateUrl: './tickets.page.html',
  styleUrls: ['./tickets.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule],
})
export class TicketsPage implements OnInit {
  isLoading = true;
  passes: TicketPass[] = [];
  isQrModalOpen = false;
  selectedPass: TicketPass | null = null;

  constructor(
    private authService: AuthService,
    private supabaseService: SupabaseService,
    private router: Router,
  ) {}

  async ngOnInit() {
    await this.loadPasses();
  }

  async loadPasses() {
    this.isLoading = true;
    try {
      const user = await this.authService.getCurrentUser();
      if (!user?.id) {
        this.passes = [];
        return;
      }

      const nowIso = new Date().toISOString();

      const { data: accessRows, error: accessError } = await this.supabaseService.client
        .from('user_door_access')
        .select('id, door_id, valid_until, granted_at')
        .eq('profile_id', user.id)
        .eq('is_granted', true)
        .or(`valid_until.gte.${nowIso},valid_until.is.null`)
        .order('granted_at', { ascending: false });

      if (accessError) {
        throw accessError;
      }

      const rows = accessRows || [];
      if (!rows.length) {
        this.passes = [];
        return;
      }

      const doorIds = Array.from(new Set(rows.map((r: any) => r.door_id).filter(Boolean)));
      const { data: assets } = await this.supabaseService.client
        .from('assets')
        .select('id, name, floor_id')
        .in('id', doorIds);

      const floorIds = Array.from(new Set((assets || []).map((a: any) => a.floor_id).filter(Boolean)));
      const { data: floors } = floorIds.length
        ? await this.supabaseService.client
            .from('floors')
            .select('id, name, building_id')
            .in('id', floorIds)
        : { data: [] as any[] };

      const buildingIds = Array.from(new Set((floors || []).map((f: any) => f.building_id).filter(Boolean)));
      const { data: buildings } = buildingIds.length
        ? await this.supabaseService.client
            .from('buildings')
            .select('id, name')
            .in('id', buildingIds)
        : { data: [] as any[] };

      const assetMap = new Map((assets || []).map((a: any) => [a.id, a]));
      const floorMap = new Map((floors || []).map((f: any) => [f.id, f]));
      const buildingMap = new Map((buildings || []).map((b: any) => [b.id, b]));

      const mappedPasses = await Promise.all(rows.map(async (row: any) => {
        const asset = assetMap.get(row.door_id);
        const floor = asset ? floorMap.get(asset.floor_id) : null;
        const building = floor ? buildingMap.get(floor.building_id) : null;
        const qrPayload = this.buildQrPayload(row);
        const qrImageDataUrl = await this.generateQrDataUrl(qrPayload);

        return {
          id: row.id,
          doorId: row.door_id,
          qrValue: `PASS-${String(row.door_id || '').slice(0, 8).toUpperCase()}`,
          qrPayload,
          qrImageDataUrl,
          roomName: asset?.name || `ประตู ${row.door_id}`,
          floorName: floor?.name || '-',
          buildingId: floor?.building_id || 'E12',
          buildingName: building?.name || '-',
          validUntil: row.valid_until || null,
          grantedAt: row.granted_at || null,
        };
      }));

      this.passes = mappedPasses;
    } catch (error) {
      console.error('Failed to load ticket passes', error);
      this.passes = [];
    } finally {
      this.isLoading = false;
    }
  }

  openBuilding(pass: TicketPass) {
    this.router.navigate(['/building-access'], { queryParams: { buildingId: pass.buildingId || 'E12' } });
  }

  openQr(pass: TicketPass) {
    this.selectedPass = pass;
    this.isQrModalOpen = true;
  }

  closeQr() {
    this.isQrModalOpen = false;
    this.selectedPass = null;
  }

  formatDateTime(value: string | null): string {
    if (!value) return 'ไม่กำหนด';
    const date = new Date(value);
    return date.toLocaleString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private buildQrPayload(row: any): string {
    return JSON.stringify({
      type: 'gate_access',
      v: 1,
      access_id: row.id,
      door_id: row.door_id,
      valid_until: row.valid_until || null,
      issued_at: row.granted_at || null,
    });
  }

  private async generateQrDataUrl(payload: string): Promise<string> {
    try {
      return await QRCode.toDataURL(payload, {
        width: 220,
        margin: 1,
        color: {
          dark: '#111827',
          light: '#FFFFFFFF'
        }
      });
    } catch (error) {
      console.error('Failed to generate QR image', error);
      return '';
    }
  }
}
