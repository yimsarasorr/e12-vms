import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { Booking } from '../../data/models';
import { ReservationService } from '../../services/reservation.service';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';
import { firstValueFrom } from 'rxjs';
import { RealtimeChannel } from '@supabase/supabase-js';

@Component({
    selector: 'app-reservation-detail',
    templateUrl: './reservation-detail.component.html',
    standalone: true,
    imports: [IonicModule, CommonModule]
})
export class ReservationDetailComponent implements OnInit, OnDestroy {
    @Input() booking!: Booking;

    internalStatus: string = '';
    statusLabel: string = '';
    circleLabelText: string = '';
    circleMainValue: string = '';
    progressOffset: number = 578;

    private timer: any;
    private realtimeChannel: RealtimeChannel | null = null;

    constructor(
      private modalCtrl: ModalController,
      private reservationService: ReservationService,
      private authService: AuthService,
      private supabaseService: SupabaseService,
      private toastCtrl: ToastController
    ) { }

    ngOnInit() {
        this.internalStatus = this.booking.status;
        this.updateStaticData();
        this.startTimer();
        this.fetchCurrentFee();
        this.setupRealtimeListener();
    }

    setupRealtimeListener() {
        // สร้างช่องทางฟังข้อมูล Realtime เฉพาะของจองรายการนี้
        this.realtimeChannel = this.supabaseService.client
            .channel(`e-stamp-updates-${this.booking.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*', // ฟังทั้ง Insert, Update, Delete
                    schema: 'public',
                    table: 'e_stamps',
                    filter: `reservation_id=eq.${this.booking.id}` 
                },
                (payload) => {
                    console.log('[ReservationDetail] Realtime update detected:', payload);
                    // เมื่อมีการเปลี่ยนแปลงส่วนลด ให้โหลดราคาใหม่ทันที
                    this.fetchCurrentFee();
                }
            )
            .subscribe();
    }

    async fetchCurrentFee() {
        if (this.internalStatus === 'active' || this.internalStatus === 'checked_in' || this.internalStatus === 'checked_in_pending_payment') {
            try {
                const fee = await this.reservationService.getParkingFee(this.booking.id);
                this.booking.price = fee;
            } catch (e) {
                console.error('Error fetching live fee:', e);
            }
        }
    }

    ngOnDestroy() {
        if (this.timer) {
            clearInterval(this.timer);
        }
        if (this.realtimeChannel) {
            this.supabaseService.client.removeChannel(this.realtimeChannel);
        }
    }

    dismiss() {
        this.modalCtrl.dismiss();
    }

    updateStaticData() {
        switch (this.internalStatus) {
            case 'active':
            case 'checked_in':
                this.statusLabel = 'กำลังจอด';
                this.circleLabelText = 'เวลาที่ผ่านไป';
                break;
            case 'confirmed':
                this.statusLabel = 'เสร็จสิ้น';
                this.circleLabelText = 'เวลาจอดรวม';
                this.progressOffset = 0; // เต็มวง
                break;
            case 'pending':
                this.statusLabel = 'กำลังตรวจสอบรายการ';
                this.circleLabelText = 'รอตรวจสอบ...';
                this.circleMainValue = '--:--:--';
                this.progressOffset = 578;
                break;
            case 'pending_payment':
                this.statusLabel = 'รอชำระเงิน';
                this.circleLabelText = 'รอชำระเงิน...';
                this.circleMainValue = '--:--:--';
                this.progressOffset = 578;
                break;
            case 'checked_in_pending_payment':
                this.statusLabel = 'กำลังจอด (รอชำระเงิน)';
                this.circleLabelText = 'เวลาที่ผ่านไป';
                break;
            case 'completed':
            case 'checked_out':
                this.statusLabel = 'เสร็จสิ้น';
                this.circleLabelText = 'เวลาจอดรวม';
                this.progressOffset = 0; // เต็มวง
                break;
            case 'cancelled':
                this.statusLabel = 'ยกเลิกแล้ว';
                this.circleLabelText = 'ถูกยกเลิก';
                this.circleMainValue = '---';
                this.progressOffset = 578;
                break;
            default:
                this.statusLabel = this.booking.statusLabel || this.internalStatus;
                this.circleLabelText = 'สถานะ';
                this.circleMainValue = '--:--:--';
                this.progressOffset = 578;
        }
    }

    startTimer() {
        this.updateTime();
        if (['active', 'checked_in', 'checked_in_pending_payment'].includes(this.internalStatus)) {
            this.timer = setInterval(() => {
                this.updateTime();
            }, 1000);
        }
    }

    updateTime() {
        const now = new Date().getTime();
        const start = new Date(this.booking.bookingTime).getTime();
        const end = new Date(this.booking.endTime).getTime();

        if (this.internalStatus === 'active' || this.internalStatus === 'checked_in' || this.internalStatus === 'checked_in_pending_payment') {
            const elapsed = now - start;
            if (elapsed < 0) {
                this.circleMainValue = "00:00:00";
                this.progressOffset = 578;
            } else {
                this.circleMainValue = this.formatTime(elapsed);
                const totalDuration = end > start ? end - start : 24 * 60 * 60 * 1000;
                const percent = Math.min(elapsed / totalDuration, 1);
                this.progressOffset = 578 - (578 * percent);
            }
        } else if (this.internalStatus === 'confirmed') {
            const remaining = start - now;
            if (remaining > 0) {
                this.circleMainValue = this.formatTime(remaining);
            } else {
                this.circleMainValue = "00:00:00";
            }
            this.progressOffset = 578;
        } else if (this.internalStatus === 'completed' || this.internalStatus === 'checked_out' || this.internalStatus === 'confirmed') {
            const elapsed = end - start;
            this.circleMainValue = this.formatTime(elapsed > 0 ? elapsed : 0);
            this.progressOffset = 0;
            if (this.timer) clearInterval(this.timer);
        }
    }

    formatTime(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        return `${this.pad(hours)}:${this.pad(minutes)}:${this.pad(seconds)}`;
    }

    pad(num: number): string {
        return num < 10 ? '0' + num : num.toString();
    }

    getDotColor(): string {
        switch (this.internalStatus) {
            case 'active':
            case 'checked_in': return 'bg-blue-500';
            case 'confirmed': return 'bg-green-500';
            case 'pending': return 'bg-amber-500';
            case 'pending_payment': 
            case 'checked_in_pending_payment': return 'bg-orange-500';
            case 'completed':
            case 'checked_out': return 'bg-green-500';
            case 'cancelled': return 'bg-red-500';
            default: return 'bg-gray-400';
        }
    }

    getTextColor(): string {
        switch (this.internalStatus) {
            case 'active':
            case 'checked_in': return 'text-blue-500';
            case 'confirmed': return 'text-green-500';
            case 'pending': return 'text-amber-500';
            case 'pending_payment': 
            case 'checked_in_pending_payment': return 'text-orange-500';
            case 'completed':
            case 'checked_out': return 'text-green-500';
            case 'cancelled': return 'text-red-500';
            default: return 'text-gray-500';
        }
    }

    getCircleColor(): string {
        switch (this.internalStatus) {
            case 'active':
            case 'checked_in': return '#3b82f6';
            case 'confirmed': return '#22c55e';
            case 'pending': return '#f59e0b';
            case 'pending_payment': 
            case 'checked_in_pending_payment': return '#f97316';
            case 'completed':
            case 'checked_out': return '#22c55e';
            case 'cancelled': return '#ef4444';
            default: return '#9ca3af';
        }
    }

    getBookingTypeLabel(type: string | undefined): string {
        switch (type) {
            case 'hourly': return 'รายชั่วโมง';
            case 'flat_24h': return 'เหมาจ่าย 24 ชม.';
            case 'monthly_regular': return 'รายเดือน';
            case 'monthly_night': return 'รายเดือน (กลางคืน)';
            default: return 'ทั่วไป';
        }
    }

    getVehicleTypeLabel(type: string | undefined): string {
        switch (type) {
            case 'car': return 'รถยนต์';
            case 'motorcycle': return 'รถจักรยานยนต์';
            case 'ev': return 'รถยนต์ไฟฟ้า (EV)';
            case 'other': return 'อื่นๆ';
            default: return type || 'รถยนต์';
        }
    }

    openMap() {
        if (this.booking.lat && this.booking.lng) {
            const url = `https://www.google.com/maps/dir/?api=1&destination=${this.booking.lat},${this.booking.lng}`;
            window.open(url, '_blank');
        }
    }

    handleCancel() {
        this.modalCtrl.dismiss({ action: 'cancel' }, 'confirm');
    }

    handleCheckout() {
        this.modalCtrl.dismiss({ action: 'checkout' }, 'confirm');
    }

    handleReceipt() {
        this.modalCtrl.dismiss({ action: 'receipt' }, 'confirm');
    }

    async handleSimulateCheckIn() {
        try {
            await this.reservationService.updateReservationStatusv2(this.booking.id, 'checked_in');
            this.internalStatus = 'checked_in';
            this.booking.status = 'checked_in';
            this.updateStaticData();
            this.startTimer();
            this.fetchCurrentFee();

            const toast = await this.toastCtrl.create({
                message: 'จำลองการเช็คอินสำเร็จ',
                duration: 2000,
                color: 'success',
                position: 'bottom'
            });
            await toast.present();
        } catch (error) {
            console.error('Error simulating check-in:', error);
        }
    }

    async handleCheckoutConfirm() {
        try {
            // FIX: Send 'confirmed' to database instead of 'completed' as requested in earlier turns
            await this.reservationService.updateReservationStatusv2(this.booking.id, 'confirmed');
            this.internalStatus = 'confirmed';
            this.booking.status = 'confirmed';
            this.updateStaticData();
            this.startTimer();

            const toast = await this.toastCtrl.create({
                message: 'เปลี่ยนสถานะเป็น ยืนยันแล้ว สำเร็จ',
                duration: 2000,
                color: 'success',
                position: 'bottom'
            });
            await toast.present();
        } catch (error) {
            console.error('Error updating status to confirmed:', error);
        }
    }

    async handlePay() {
        try {
            await this.reservationService.updateReservationStatusv2(this.booking.id, 'pending');
            this.internalStatus = 'pending';
            this.booking.status = 'pending';
            this.updateStaticData();
            
            const toast = await this.toastCtrl.create({
                message: 'ชำระเงินสำเร็จ กำลังตรวจสอบรายการ',
                duration: 2000,
                color: 'success',
                position: 'bottom'
            });
            await toast.present();
        } catch (error) {
            console.error('Error processing payment:', error);
        }
    }

    async handleApplyStamp() {
        try {
            // ดึง ID ผู้ใช้ปัจจุบันจาก Service โดยตรง (เสถียรกว่า)
            const userId = this.reservationService.getCurrentProfileId();
            
            if (!userId) {
                this.showToast('ไม่พบข้อมูลผู้ใช้งาน กรุณาลองใหม่อีกครั้ง', 'danger');
                return;
            }

            const res = await this.reservationService.applyEStamp(this.booking.id, userId);
            if (res.success) {
                this.showToast(res.message || 'ลดราคาสำเร็จ!', 'success');
                // Refresh ราคาทันทีหลังลดสำเร็จ
                await this.fetchCurrentFee();
            } else {
                this.showToast(res.error || 'ไม่สามารถลดราคาได้', 'danger');
            }
        } catch (e: any) {
            console.error('Error applying stamp:', e);
            this.showToast(e.message || 'เกิดข้อผิดพลาดในการลดราคา', 'danger');
        }
    }

    async showToast(message: string, color: string = 'success') {
        const toast = await this.toastCtrl.create({
            message,
            duration: 2000,
            color,
            position: 'bottom'
        });
        await toast.present();
    }

    async handleCheckInPendingPayment() {
        try {
            await this.reservationService.updateReservationStatusv2(this.booking.id, 'checked_in_pending_payment');
            this.internalStatus = 'checked_in_pending_payment';
            this.booking.status = 'checked_in_pending_payment';
            this.updateStaticData();
            this.startTimer();
            this.fetchCurrentFee();

            const toast = await this.toastCtrl.create({
                message: 'เข้าจอดเรียบร้อย (รอชำระเงิน)',
                duration: 2000,
                color: 'success',
                position: 'bottom'
            });
            await toast.present();
        } catch (error) {
            console.error('Error checking in (pending payment):', error);
        }
    }
}
