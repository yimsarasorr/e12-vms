import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ModalController } from '@ionic/angular/standalone';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-invite-visitor-modal',
  templateUrl: './invite-visitor-modal.component.html',
  styleUrls: ['./invite-visitor-modal.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule]
})
export class InviteVisitorModalComponent implements OnInit {
  selectedFloor: number | null = null;
  selectedRoom: string = '';
  availableRooms: any[] = [];
  visitorCount: number = 1;
  passType: string = '1-day';
  startDate: string = new Date().toISOString();
  expiryDate: string = '';

  isLoading = false;
  isSuccess = false;
  generatedCode = '';

  floors = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  constructor(private modalCtrl: ModalController, private supabase: SupabaseService) {}

  ngOnInit() { this.updateExpiry(); }

  async onFloorChange() {
    this.selectedRoom = '';
    this.availableRooms = [];
    if (!this.selectedFloor) return;

    try {
      const { data, error } = await this.supabase.client
        .from('floors')
        .select('layout_data')
        .eq('building_id', 'E12')
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
    this.generatedCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const { data: user } = await this.supabase.client.auth.getUser();

    const ticketData = {
      invite_code: this.generatedCode,
      building_id: 'E12',
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
    } catch (err) {
      console.error('Error generating ticket:', err);
    } finally {
      this.isLoading = false;
    }
  }

  dismiss() { this.modalCtrl.dismiss(); }
}
