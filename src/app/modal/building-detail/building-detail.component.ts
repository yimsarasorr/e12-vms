import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalController, ToastController } from '@ionic/angular';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { ParkingLot } from '../../data/models';
import { ParkingDataService } from '../../services/parking-data.service';
import { BookmarkService } from '../../services/bookmark.service';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';
import { addIcons } from 'ionicons';
import {
    closeOutline, locationOutline, peopleOutline, cubeOutline, timeOutline,
    chevronDownOutline, keyOutline, personOutline, calendarNumberOutline,
    caretDownOutline, chevronBackOutline, chevronForwardOutline, swapHorizontalOutline,
    checkmarkOutline, heartOutline, heart, qrCodeOutline
} from 'ionicons/icons';

interface AccessPassSummary {
    totalGranted: number;
    roomLabels: string[];
    expiresAt: string | null;
}

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
    isLoadingAccessPass = true;
    accessPassSummary: AccessPassSummary = {
        totalGranted: 0,
        roomLabels: [],
        expiresAt: null,
    };

    availableSites: ParkingLot[] = [];

    constructor(
        private modalCtrl: ModalController,
        private router: Router,
        private parkingService: ParkingDataService,
        private bookmarkService: BookmarkService,
        private toastCtrl: ToastController,
        private authService: AuthService,
        private supabaseService: SupabaseService,
    ) {
        addIcons({
            closeOutline, locationOutline, peopleOutline, cubeOutline, timeOutline,
            chevronDownOutline, keyOutline, personOutline, calendarNumberOutline,
            caretDownOutline, chevronBackOutline, chevronForwardOutline, swapHorizontalOutline,
            checkmarkOutline, heartOutline, heart, qrCodeOutline
        });
    }

    ngOnInit() {
        this.parkingService.parkingLots$.subscribe(lots => {
            if (lots && lots.length > 0) {
                this.availableSites = lots.filter((item) => String(item.category || 'building').toLowerCase() === 'building');
            }
        });
        this.checkBookmarkStatus();
        this.loadAccessPassSummary();
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

    openBuildingAccess() {
        this.modalCtrl.dismiss().then(() => {
            this.router.navigate(['/building-access'], { queryParams: { buildingId: this.lot.id } });
        });
    }

    private async loadAccessPassSummary() {
        this.isLoadingAccessPass = true;

        try {
            const user = await this.authService.getCurrentUser();
            if (!user?.id) {
                this.accessPassSummary = {
                    totalGranted: 0,
                    roomLabels: [],
                    expiresAt: null,
                };
                return;
            }

            const { data: accesses, error: accessError } = await this.supabaseService.client
                .from('user_door_access')
                .select('door_id, valid_until, is_granted')
                .eq('profile_id', user.id)
                .eq('is_granted', true);

            if (accessError) {
                throw accessError;
            }

            const grantedRows = accesses || [];
            if (!grantedRows.length) {
                this.accessPassSummary = {
                    totalGranted: 0,
                    roomLabels: [],
                    expiresAt: null,
                };
                return;
            }

            const doorIds = Array.from(new Set(grantedRows.map((row: any) => row.door_id).filter(Boolean)));
            let roomLabels: string[] = doorIds.map((id: string) => `ประตู ${id}`);

            // Try mapping door IDs to asset names within current building floors.
            const { data: floorsInBuilding } = await this.supabaseService.client
                .from('floors')
                .select('id')
                .eq('building_id', this.lot.id);

            const floorIds = (floorsInBuilding || []).map((f: any) => f.id).filter(Boolean);
            if (floorIds.length && doorIds.length) {
                const { data: assetRows } = await this.supabaseService.client
                    .from('assets')
                    .select('id,name,floor_id')
                    .in('id', doorIds)
                    .in('floor_id', floorIds);

                if (assetRows && assetRows.length) {
                    const assetMap = new Map(assetRows.map((a: any) => [a.id, a.name || a.id]));
                    roomLabels = doorIds.map((id: string) => assetMap.get(id) || `ประตู ${id}`);
                }
            }

            const expireCandidates = grantedRows
                .map((row: any) => row.valid_until)
                .filter((val: string | null) => !!val) as string[];

            const expiresAt = expireCandidates.length
                ? expireCandidates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
                : null;

            this.accessPassSummary = {
                totalGranted: doorIds.length,
                roomLabels,
                expiresAt,
            };
        } catch (error) {
            console.error('Failed to load access pass summary', error);
            this.accessPassSummary = {
                totalGranted: 0,
                roomLabels: [],
                expiresAt: null,
            };
        } finally {
            this.isLoadingAccessPass = false;
        }
    }

    // --- Helper Methods ---
    getFloorName(f: any): string {
        if (typeof f === 'string') return f;
        return f.name || '';
    }

    get floors(): any[] {
        return this.lot?.floors || [];
    }

    get accessHeadline(): string {
        if (this.isLoadingAccessPass) return 'กำลังโหลดสิทธิ์การเข้าอาคาร...';
        if (!this.accessPassSummary.totalGranted) return 'ยังไม่มีสิทธิ์เข้าพื้นที่';
        return `คุณมีสิทธิ์เข้า ${this.accessPassSummary.totalGranted} พื้นที่`;
    }

    get accessSummaryLine(): string {
        if (!this.accessPassSummary.roomLabels.length) return 'กรุณาลงทะเบียนรหัสคำเชิญจาก Host';
        return this.accessPassSummary.roomLabels.slice(0, 2).join(' | ');
    }

    get expiresLabel(): string {
        if (!this.accessPassSummary.expiresAt) return 'ไม่กำหนดวันหมดอายุ';
        const d = new Date(this.accessPassSummary.expiresAt);
        return `หมดอายุ ${d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}`;
    }

    selectSite(s: ParkingLot) {
        console.log('Selected site:', s);
        // Update the current lot with selected site info
        this.lot = s;

        // Dismiss popover
        const popover = document.querySelector('ion-popover.menu-popover') as any;
        if (popover && popover.dismiss) popover.dismiss();
    }

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
