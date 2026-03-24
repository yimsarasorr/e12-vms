import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { Router } from '@angular/router';
import { BuildingViewComponent } from '../../components/building-view/building-view.component';
import buildingFloorData from '../../components/floor-plan/e12-floor1.json';

@Component({
    selector: 'app-building-3d-modal',
    standalone: true,
    imports: [CommonModule, IonicModule, BuildingViewComponent],
    templateUrl: './building-3d-modal.component.html',
    styleUrls: ['./building-3d-modal.component.scss']
})
export class Building3dModalComponent implements OnInit {
    @Input() buildingData: any;

    floors: any[] = [];
    selectedFloor: number | null = null;
    buildingName: string = '';

    constructor(
        private modalCtrl: ModalController,
        private router: Router
    ) { }

    ngOnInit() {
        this.buildingName = this.buildingData?.name || 'Building';

        // Fallback to imported JSON if not provided directly in buildingData
        if (this.buildingData?.floors) {
            this.floors = this.buildingData.floors;
        } else {
            this.floors = buildingFloorData.floors;
        }

        // Set a default selected floor or leave null
        if (this.floors && this.floors.length > 0) {
            // this.selectedFloor = 1; 
        }
    }

    dismiss() {
        this.modalCtrl.dismiss();
    }

    onFloorSelected(floorNum: number) {
        console.log('Selected floor:', floorNum);
        this.selectedFloor = floorNum;

        // Add a slight delay so the user sees the floor get highlighted before navigating
        setTimeout(() => {
            this.modalCtrl.dismiss().then(() => {
                this.router.navigate(['/building-access'], {
                    queryParams: {
                        buildingId: this.buildingData?.id || 'school-building-01',
                        floor: floorNum
                    }
                });
            });
        }, 300);
    }
}
