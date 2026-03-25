import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ModalController, ToastController } from '@ionic/angular/standalone';
import { SupabaseService } from '../../services/supabase.service';
import { ReservationService } from '../../services/reservation.service';

@Component({
  selector: 'app-register-code-modal',
  templateUrl: './register-code-modal.component.html',
  styleUrls: ['./register-code-modal.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule]
})
export class RegisterCodeModalComponent {
  inviteCode: string = '';
  isLoading = false;
  errorMessage: string = '';

  constructor(
    private modalCtrl: ModalController,
    private supabase: SupabaseService,
    private reservationService: ReservationService,
    private toastCtrl: ToastController
  ) {}

  dismiss() { this.modalCtrl.dismiss(); }

  async submitCode() {
    if (this.inviteCode.length < 6) return;
    this.isLoading = true;
    this.errorMessage = '';
    this.inviteCode = this.inviteCode.trim().toUpperCase();

    const visitorId = await this.resolveVisitorId();
    if (!visitorId) {
      this.errorMessage = 'ไม่พบข้อมูลผู้ใช้งาน กรุณาล็อกอินใหม่';
      this.isLoading = false;
      return;
    }

    try {
      const { data, error } = await this.supabase.client.rpc('claim_invite_code', {
        p_code: this.inviteCode,
        p_visitor_id: visitorId
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'รหัสไม่ถูกต้องหรือหมดอายุแล้ว');

      // ดึง room_id (door_id) จากตาราง access_tickets
      const { data: ticketData, error: ticketError } = await this.supabase.client
        .from('access_tickets')
        .select('room_id, expires_at')
        .eq('invite_code', this.inviteCode)
        .maybeSingle();

      if (!ticketError && ticketData?.room_id) {
        // บันทึก user_door_access เพื่อให้ access-list ดึงได้
        const { error: accessError } = await this.supabase.client.from('user_door_access').upsert({
          profile_id: visitorId,
          door_id: ticketData.room_id,
          is_granted: true,
          valid_until: ticketData.expires_at
        }, {
          onConflict: 'profile_id,door_id'
        });

        if (accessError) {
          throw accessError;
        }
      }

      const toast = await this.toastCtrl.create({
        message: 'ได้รับบัตรผ่านเข้าอาคารเรียบร้อยแล้ว!',
        duration: 3000,
        color: 'success'
      });
      toast.present();

      this.modalCtrl.dismiss({ code: this.inviteCode }, 'confirm');
    } catch (err: any) {
      if (String(err?.code || '') === '23505') {
        this.errorMessage = 'สิทธิ์ห้องนี้ถูกบันทึกแล้วในบัญชีนี้';
      } else {
        this.errorMessage = err.message || 'รหัสไม่ถูกต้องหรือหมดอายุแล้ว';
      }
    } finally {
      this.isLoading = false;
    }
  }

  private async resolveVisitorId(): Promise<string> {
    // Prefer current auth user id; fallback to in-memory reservation context.
    const { data, error } = await this.supabase.client.auth.getUser();
    if (!error && data?.user?.id) {
      return data.user.id;
    }

    const contextId = this.reservationService.getCurrentProfileId();
    return contextId ? String(contextId).trim() : '';
  }
}
