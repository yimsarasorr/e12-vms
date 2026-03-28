import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ModalController } from '@ionic/angular/standalone';
import { SupabaseService } from '../../services/supabase.service';

interface BuildingOption {
  id: string;
  name: string;
}

@Component({
  selector: 'app-invite-visitor-modal',
  templateUrl: './invite-visitor-modal.component.html',
  styleUrls: ['./invite-visitor-modal.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule]
})
export class InviteVisitorModalComponent implements OnInit {
  selectedBuildingId: string = 'E12';
  selectedBuildingName: string = 'E12';
  selectedFloor: number | null = null;
  selectedRoom: string = '';
  buildings: BuildingOption[] = [];
  floors: number[] = [];
  availableRooms: any[] = [];
  visitorCount: number = 1;
  passType: string = '1-day';
  startDate: string = new Date().toISOString();
  expiryDate: string = '';

  isLoading = false;
  isSuccess = false;
  generatedCode = '';
  errorMessage = '';
  copySuccess = false;

  constructor(private modalCtrl: ModalController, private supabase: SupabaseService) {}

  async ngOnInit() {
    this.updateExpiry();
    await this.loadBuildings();
  }

  async loadBuildings() {
    try {
      const { data, error } = await this.supabase.client
        .from('buildings')
        .select('id, name')
        .order('name', { ascending: true });

      if (error) throw error;

      this.buildings = (data || []).map((b: any) => ({
        id: String(b.id),
        name: String(b.name || b.id)
      }));

      if (!this.buildings.length) {
        this.buildings = [{ id: 'E12', name: 'E12' }];
      }

      if (!this.buildings.find((b) => b.id === this.selectedBuildingId)) {
        this.selectedBuildingId = this.buildings[0].id;
      }

      this.selectedBuildingName = this.getSelectedBuildingName(this.selectedBuildingId);
      await this.loadFloorsForBuilding();
    } catch (err) {
      console.error('Error loading buildings:', err);
      this.buildings = [{ id: 'E12', name: 'E12' }];
      this.selectedBuildingId = 'E12';
      this.selectedBuildingName = 'E12';
      await this.loadFloorsForBuilding();
    }
  }

  async onBuildingChange() {
    this.selectedBuildingName = this.getSelectedBuildingName(this.selectedBuildingId);
    this.selectedFloor = null;
    this.selectedRoom = '';
    this.availableRooms = [];
    await this.loadFloorsForBuilding();
  }

  async loadFloorsForBuilding() {
    this.floors = [];
    try {
      const { data, error } = await this.supabase.client
        .from('floors')
        .select('level_order')
        .eq('building_id', this.selectedBuildingId)
        .order('level_order', { ascending: true });

      if (error) throw error;

      this.floors = Array.from(new Set((data || []).map((f: any) => Number(f.level_order)).filter((v) => !Number.isNaN(v))));
    } catch (err) {
      console.error('Error loading floors:', err);
      this.floors = [];
    }
  }

  async onFloorChange() {
    this.selectedRoom = '';
    this.availableRooms = [];
    if (!this.selectedFloor) return;

    try {
      const { data, error } = await this.supabase.client
        .from('floors')
        .select('layout_data')
        .eq('building_id', this.selectedBuildingId)
        .eq('level_order', this.selectedFloor)
        .maybeSingle();

      if (error) throw error;

      if (data?.layout_data?.zones) {
        const rooms: any[] = [];
        data.layout_data.zones.forEach((zone: any) => {
          if (zone.rooms) {
            zone.rooms.forEach((room: any) => rooms.push(room));
          }
        });
        this.availableRooms = rooms;
      } else {
        console.warn('ไม่พบข้อมูลห้องในชั้นนี้');
      }
    } catch (err) {
      console.error('Error fetching rooms:', err);
    }
  }

  getRoomAccessId(room: any): string {
    return room?.doors?.[0]?.id || room?.id || '';
  }

  updateExpiry() {
    const start = new Date(this.startDate);
    if (this.passType === '1-time' || this.passType === '1-day') {
      start.setHours(23, 59, 59);
    } else if (this.passType === '2-day') {
      start.setDate(start.getDate() + 1);
      start.setHours(23, 59, 59);
    }
    this.expiryDate = start.toISOString();
  }

  async generateTicket() {
    this.isLoading = true;
    this.errorMessage = '';
    this.generatedCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const { data: user } = await this.supabase.client.auth.getUser();

    const ticketData = {
      invite_code: this.generatedCode,
      building_id: this.selectedBuildingId,
      floor: this.selectedFloor,
      room_id: this.selectedRoom,
      max_usage: this.visitorCount,
      pass_type: this.passType,
      valid_from: this.startDate,
      expires_at: this.expiryDate,
      host_id: user.user?.id,
    };

    try {
      const { error } = await this.supabase.client.from('access_tickets').insert(ticketData);
      if (error) throw error;
      this.isSuccess = true;
    } catch (err: any) {
      console.error('Error generating ticket:', err);
      this.errorMessage = String(err?.message || 'ไม่สามารถสร้างคำเชิญได้');
    } finally {
      this.isLoading = false;
    }
  }

  getSelectedBuildingName(buildingId: string): string {
    return this.buildings.find((b) => b.id === buildingId)?.name || buildingId;
  }

  async copyCode() {
    try {
      await navigator.clipboard.writeText(this.generatedCode);
      this.copySuccess = true;
      setTimeout(() => {
        this.copySuccess = false;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  dismiss() { this.modalCtrl.dismiss(); }
}
