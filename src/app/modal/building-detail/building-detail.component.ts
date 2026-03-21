
import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalController, ToastController } from '@ionic/angular';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { ParkingLot } from '../../data/models';
import { ParkingDataService } from '../../services/parking-data.service';
import { ReservationService } from '../../services/reservation.service';
import { AddVehicleModalComponent } from '../add-vehicle/add-vehicle-modal.component';
import { take } from 'rxjs/operators';
import { BookmarkService } from '../../services/bookmark.service';
// Remove unused service import if not needed, or keep for future
import { BottomSheetService } from '../../services/bottom-sheet.service';
import { addIcons } from 'ionicons';
import {
    closeOutline, locationOutline, peopleOutline, cubeOutline, timeOutline,
    chevronDownOutline, keyOutline, personOutline, calendarNumberOutline,
    caretDownOutline, chevronBackOutline, chevronForwardOutline, swapHorizontalOutline,
    checkmarkOutline, heartOutline, heart
} from 'ionicons/icons';

@Component({
    selector: 'app-building-detail',
    templateUrl: './building-detail.component.html',
    styleUrls: ['./building-detail.component.scss'],
    standalone: true,
    imports: [IonicModule, CommonModule, FormsModule]
})
export class BuildingDetailComponent implements OnInit {

    @Input() lot!: ParkingLot;

    isBookmarked: boolean = false;

    // --- Mock Data for UI ---
    availableSites: ParkingLot[] = [];

    // --- Filter States ---
    selectedPassType: string = '1-day'; // '1-day', 'visitor', 'monthly'
    selectedUserRole: string = 'user'; // 'user', 'admin', 'staff'
    selectedDuration: number = 60; // Minutes
    selectedBookingDays: number = 1;

    // --- Calendar State ---
    currentDisplayedDate: Date = new Date();
    currentMonthLabel: string = '';
    displayDays: any[] = [];
    selectedDateIndex: number = 0;

    constructor(
        private modalCtrl: ModalController,
        private router: Router,
        private parkingService: ParkingDataService,
        private reservationService: ReservationService,
        private bookmarkService: BookmarkService,
        private toastCtrl: ToastController
    ) {
        addIcons({
            closeOutline, locationOutline, peopleOutline, cubeOutline, timeOutline,
            chevronDownOutline, keyOutline, personOutline, calendarNumberOutline,
            caretDownOutline, chevronBackOutline, chevronForwardOutline, swapHorizontalOutline,
            checkmarkOutline, heartOutline, heart
        });
    }

    ngOnInit() {
        this.generateCalendar();
        this.parkingService.parkingLots$.subscribe(lots => {
            if (lots && lots.length > 0) {
                // Filter out current lot if needed, or just show all
                this.availableSites = lots;
            }
        });
        this.checkBookmarkStatus();
    }

    async checkBookmarkStatus() {
        if (this.lot?.id) {
            this.isBookmarked = await this.bookmarkService.checkIsBookmarked(this.lot.id);
        }
    }

    async toggleBookmark() {
        if (!this.lot?.id) return;

        try {
            if (this.isBookmarked) {
                await this.bookmarkService.removeBookmark(this.lot.id);
                this.isBookmarked = false;
                this.presentToast('นำออกจากบันทึกแล้ว', 'success');
            } else {
                await this.bookmarkService.addBookmark(this.lot.id);
                this.isBookmarked = true;
                this.presentToast('บันทึกสถานที่แล้ว', 'success');
            }
        } catch (error) {
            this.presentToast('เกิดข้อผิดพลาด กรุณาลองใหม่');
        }
    }

    dismiss() {
        this.modalCtrl.dismiss();
    }

    view3DFloorPlan() {
        this.modalCtrl.dismiss().then(() => {
            this.router.navigate(['/tabs/building'], { queryParams: { buildingId: this.lot.id } });
        });
    }

    checkRights() {
        console.log('Checking rights...');
        this.parkingService.vehicles$.pipe(take(1)).subscribe(async (vehicles) => {
            if (vehicles && vehicles.length > 0) {
                // If has vehicles, proceed to next step
                this.proceedToBooking();
            } else {
                // No vehicles, show Add Vehicle modal
                const modal = await this.modalCtrl.create({
                    component: AddVehicleModalComponent,
                    breakpoints: [0, 1],
                    initialBreakpoint: 1,
                });
                await modal.present();

                const { data, role } = await modal.onDidDismiss();
                if (role === 'confirm' && data) {
                    try {
                        await this.parkingService.addVehicle(data);
                        const userId = this.reservationService.getCurrentProfileId();
                        await this.parkingService.loadUserVehicles(userId);
                        this.proceedToBooking();
                    } catch (e: any) {
                        console.error('Error adding vehicle', e);
                        const msg = e.message === 'รถป้ายทะเบียนนี้มีอยู่ในระบบแล้ว'
                            ? e.message
                            : 'เกิดข้อผิดพลาดในการเพิ่มรถ';
                        this.presentToast(msg);
                    }
                }
            }
        });
    }

    proceedToBooking() {
        console.log('Proceeding to booking with at least 1 car...');
        this.modalCtrl.dismiss().then(() => {
            // Example action: map navigate or show parking detail
            // For now, doing standard tab4 navigation since building-detail is a high-level component
            this.router.navigate(['/tabs/building'], { queryParams: { buildingId: this.lot.id } });
        });
    }

    // --- Helper Methods ---
    getFloorName(f: any): string {
        if (typeof f === 'string') return f;
        return f.name || '';
    }

    get floors(): any[] {
        return this.lot?.floors || [];
    }

    // --- UI Logic Methods ---

    selectSite(s: ParkingLot) {
        console.log('Selected site:', s);
        // Update the current lot with selected site info
        this.lot = s;

        // Dismiss popover
        const popover = document.querySelector('ion-popover.menu-popover') as any;
        if (popover && popover.dismiss) popover.dismiss();
    }

    selectPassType(type: string) {
        this.selectedPassType = type;
        const popover = document.querySelector('ion-popover.pass-type-popover') as any;
        if (popover) popover.dismiss();
    }

    selectUserRole(role: string) {
        this.selectedUserRole = role;
        const popover = document.querySelector('ion-popover.role-popover') as any;
        if (popover) popover.dismiss();
    }

    selectDuration(minutes: number) {
        this.selectedDuration = minutes;
        const popover = document.querySelector('ion-popover.duration-popover') as any;
        if (popover) popover.dismiss();
    }

    selectBookingDays(days: number) {
        this.selectedBookingDays = days;
        const popover = document.querySelector('ion-popover.days-popover') as any;
        if (popover) popover.dismiss();
    }

    // --- Calendar Logic ---
    generateCalendar() {
        this.displayDays = [];
        const baseDate = new Date(); // Start from today
        const thaiMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
        const thaiDays = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

        this.currentMonthLabel = `${thaiMonths[baseDate.getMonth()]} ${baseDate.getFullYear() + 543}`;

        for (let i = 0; i < 14; i++) { // Generate 2 weeks
            const d = new Date(baseDate);
            d.setDate(baseDate.getDate() + i);

            this.displayDays.push({
                date: d,
                dayName: thaiDays[d.getDay()],
                dateNumber: d.getDate(),
                isSelected: i === 0
            });
        }
    }

    selectDate(index: number) {
        this.selectedDateIndex = index;
    }

    changeMonth(offset: number) {
        // Mock method if needed strictly for month navigation, 
        // but horizontal scroll usually suffices for short term.
        console.log('Change month', offset);
    }

    // --- Map Navigation ---
    openMap(lat?: number, lng?: number) {
        if (!lat || !lng) {
            console.warn('Coordinates not available for this location.');
            return;
        }

        // Always use Google Maps
        const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
        window.open(url, '_blank');
    }

    async presentToast(message: string, color: string = 'dark') {
        const toast = await this.toastCtrl.create({
            message: message,
            duration: 2000,
            color: color,
            position: 'bottom',
        });
        toast.present();
    }
}
