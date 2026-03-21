import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { BuildingData } from '../data/models';
import { BuildingDataService } from '../services/building-data.service';
import { AccessControlService } from '../services/access-control.service';
import { FloorplanInteractionService } from '../services/floorplan/floorplan-interaction.service';
import { BottomSheetService } from '../services/bottom-sheet.service';
import { BuildingViewComponent } from '../components/building-view/building-view.component';
import { FloorPlanComponent } from '../components/floor-plan/floor-plan.component';
import { BottomSheetComponent } from '../components/ui/bottom-sheet/bottom-sheet.component';

@Component({
  selector: 'app-building',
  templateUrl: 'building.page.html',
  styleUrls: ['building.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, BuildingViewComponent, FloorPlanComponent, BottomSheetComponent],
})
export class BuildingPage implements OnInit {

  buildingData: BuildingData | null = null;
  selectedFloor: number | null = null;
  selectedFloorData: any = null;

  constructor(
    private buildingService: BuildingDataService,
    private route: ActivatedRoute,
    private accessControl: AccessControlService,
    private interaction: FloorplanInteractionService,
    private bottomSheetService: BottomSheetService
  ) { }

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      const bId = params['buildingId'] || 'school-building-01'; // Default Fallback
      const floorParam = params['floor'];

      // Auto-select floor if provided via queryParams
      if (floorParam) {
        this.selectedFloor = parseInt(floorParam, 10);
      } else {
        this.selectedFloor = null;
        this.selectedFloorData = null;
      }

      this.loadBuilding(bId);
      this.loadDoorPermissions();

      // 🟢 Open access-list automatically after permissions load
      setTimeout(() => {
        this.bottomSheetService.open(
          'access-list',
          undefined,
          'สิทธิ์เข้าอาคารของคุณ',
          'peek'
        );
      }, 300);
    });
  }

  async loadDoorPermissions() {
    const accessibleDoors = await this.accessControl.getAccessibleDoors();
    this.interaction.setPermissionList(accessibleDoors);
  }

  loadBuilding(id: string) {
    this.buildingService.getBuilding(id).subscribe(data => {
      this.buildingData = data;

      // If a floor was pre-selected from navigation
      if (this.selectedFloor !== null) {
        this.onFloorSelected(this.selectedFloor);
      }
    });
  }

  onFloorSelected(floorNumber: number | string) {
    if (!this.buildingData) return;

    // หาข้อมูลชั้นจาก floors array
    // Convert both to Number to ensure they match safely
    const numFloor = Number(floorNumber);
    const floor = this.buildingData.floors.find(f => Number(f.floor) === numFloor);

    if (floor) {
      this.selectedFloor = numFloor;
      this.selectedFloorData = floor;
      // 🟢 Refresh permission when floor changes
      this.loadDoorPermissions();
    } else {
      console.warn(`Floor ${floorNumber} not found in building data.`, this.buildingData.floors);
    }
  }

  onBackToBuilding() {
    this.selectedFloor = null;
    this.selectedFloorData = null;
  }
}
