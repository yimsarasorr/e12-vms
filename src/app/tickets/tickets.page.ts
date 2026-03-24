import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';
import { Router } from '@angular/router';

interface TicketPass {
  id: string;
  doorId: string;
  qrValue: string;
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

      const { data: accessRows, error: accessError } = await this.supabaseService.client
        .from('user_door_access')
        .select('id, door_id, valid_until, granted_at')
        .eq('profile_id', user.id)
        .eq('is_granted', true)
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

      this.passes = rows.map((row: any) => {
        const asset = assetMap.get(row.door_id);
        const floor = asset ? floorMap.get(asset.floor_id) : null;
        const building = floor ? buildingMap.get(floor.building_id) : null;

        return {
          id: row.id,
          doorId: row.door_id,
          qrValue: `PASS-${String(row.door_id || '').slice(0, 8).toUpperCase()}`,
          roomName: asset?.name || `ประตู ${row.door_id}`,
          floorName: floor?.name || '-',
          buildingId: floor?.building_id || 'E12',
          buildingName: building?.name || '-',
          validUntil: row.valid_until || null,
          grantedAt: row.granted_at || null,
        };
      });
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
}
