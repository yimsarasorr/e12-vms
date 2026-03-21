import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { BookmarkService } from '../services/bookmark.service';
import { Router } from '@angular/router';
import { ModalController } from '@ionic/angular';
import { BookingTypeSelectorComponent } from '../modal/booking-type-selector/booking-type-selector.component';
import { ParkingDetailComponent } from '../modal/parking-detail/parking-detail.component';
import { BuildingDetailComponent } from '../modal/building-detail/building-detail.component';

@Component({
    selector: 'app-saved',
    templateUrl: 'saved.page.html',
    styleUrls: ['saved.page.scss'],
    standalone: true,
    imports: [IonicModule, CommonModule]
})
export class SavedPage implements OnInit {
    savedPlaces: any[] = [];
    isLoading: boolean = true;

    constructor(
        private bookmarkService: BookmarkService,
        private router: Router,
        private modalCtrl: ModalController
    ) { }

    ngOnInit() { }

    async ionViewWillEnter() {
        this.isLoading = true;
        try {
            this.savedPlaces = await this.bookmarkService.getSavedPlaces();
        } catch (error) {
            console.error('Error fetching saved places', error);
            this.savedPlaces = [];
        } finally {
            this.isLoading = false;
        }
    }

    async goToDetail(building: any) {
        // 0. Check if it's a building -> Open Building Detail Modal
        if (building.category === 'building') {
            const modal = await this.modalCtrl.create({
                component: BuildingDetailComponent,
                componentProps: {
                    lot: building
                },
                initialBreakpoint: 1,
                breakpoints: [0, 1],
                backdropDismiss: true,
                showBackdrop: true,
                cssClass: 'detail-sheet-modal',
            });
            await modal.present();
            return;
        }

        // 1. Show Booking Type Selector First
        const typeModal = await this.modalCtrl.create({
            component: BookingTypeSelectorComponent,
            cssClass: 'auto-height-modal',
            initialBreakpoint: 0.65,
            breakpoints: [0, 0.65, 1],
            showBackdrop: true,
            backdropDismiss: true
        });

        await typeModal.present();
        const { data, role } = await typeModal.onDidDismiss();

        // If user cancelled, stop here
        if (role !== 'confirm' || !data) {
            return;
        }

        const selectedBookingMode = data.bookingMode; // 'daily', 'monthly', 'flat24', 'monthly_night'

        // 2. Open Parking Detail with Selected Mode
        const modal = await this.modalCtrl.create({
            component: ParkingDetailComponent,
            componentProps: {
                lot: building,
                initialType: 'normal',
                bookingMode: selectedBookingMode
            },
            initialBreakpoint: 1,
            breakpoints: [0, 1],
            backdropDismiss: true,
            showBackdrop: true,
            cssClass: 'detail-sheet-modal',
        });
        await modal.present();
    }

    async removeBookmark(building: any, event: Event) {
        event.stopPropagation();
        try {
            await this.bookmarkService.removeBookmark(building.id);
            this.savedPlaces = this.savedPlaces.filter(p => p.id !== building.id);
        } catch (e) {
            console.error(e);
        }
    }
}
