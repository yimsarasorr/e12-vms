import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  HostListener,
  Output,
  EventEmitter,
  Input,
  OnChanges,
  SimpleChanges,
  NgZone,
  inject,
  OnDestroy,
  ChangeDetectionStrategy
} from '@angular/core';
import * as THREE from 'three';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, Subscription } from 'rxjs';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonModal,
  IonList,
  IonItem,
  IonLabel,
  IonPopover
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chevronBack, expand, contract, layers, location,
  chevronDown, checkmark, gameController, add, remove,
  close, map, cube
} from 'ionicons/icons';

import { ThreeSceneService } from '../../services/floorplan/three-scene.service';
import { FloorplanBuilderService } from '../../services/floorplan/floorplan-builder.service';
import { PlayerControlsService } from '../../services/floorplan/player-controls.service';
import {
  FloorplanInteractionService,
  FloorplanViewportState
} from '../../services/floorplan/floorplan-interaction.service';
import { JoystickComponent } from '../joystick/joystick.component';

@Component({
  selector: 'app-floor-plan',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    JoystickComponent,
    IonButton,
    IonContent,
    IonIcon,
    IonModal,
    IonList,
    IonItem,
    IonLabel,
    IonPopover,
    TitleCasePipe
  ],
  templateUrl: './floor-plan.component.html',
  styleUrls: ['./floor-plan.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FloorPlanComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('container') private containerRef!: ElementRef<HTMLDivElement>;
  @ViewChild(IonPopover) floorPopover!: IonPopover;

  @Input() floorData: any;
  @Input() floors: any[] = [];
  @Input() activeFloorValue: number | null = null;
  @Input() panToTarget: any;
  @Input() showBackButton = false;
  @Input() headerTitle?: string;
  @Input() fullscreenContext = false;
  @Output() zoneChanged = new EventEmitter<string | null>();
  @Output() floorChange = new EventEmitter<number>();
  @Output() backRequested = new EventEmitter<void>();
  @Output() fullscreenChange = new EventEmitter<boolean>();

  private threeScene = inject(ThreeSceneService);
  private floorBuilder = inject(FloorplanBuilderService);
  private playerControls = inject(PlayerControlsService);
  public interaction = inject(FloorplanInteractionService);

  private ngZone = inject(NgZone);
  private resizeObserver?: ResizeObserver;

  private floorGroup: THREE.Group | null = null;
  public currentView: 'iso' | 'top' = 'iso';
  public isJoystickVisible = true;
  public floorOptions: { label: string; value: number }[] = [];

  private readonly playerPositionDisplaySubject = new BehaviorSubject<string>('');
  public readonly playerPositionDisplay$ = this.playerPositionDisplaySubject.asObservable();
  public detailDialogVisible = false;

  private cameraLookAtTarget = new THREE.Vector3();
  private isInitialized = false;
  private subscriptions = new Subscription();

  // Zoom configuration
  private currentZoomLevel = 1.0;
  private readonly minZoomLevel = 0.5;
  private readonly maxZoomLevel = 4.0;
  private readonly zoomStep = 0.2;
  private readonly CAMERA_DISTANCE_FACTOR = 6.0;

  constructor() {
    addIcons({
      chevronBack, expand, contract, layers, location,
      chevronDown, checkmark, gameController, add, remove,
      close, map, cube
    });

    this.subscriptions.add(
      this.interaction.currentZoneId$.subscribe(zoneId => {
        this.zoneChanged.emit(zoneId);
      })
    );

    this.subscriptions.add(
      this.interaction.focusRequest$.subscribe(target => {
        if (target?.data) {
          this.panCameraToObject(target.data);
        }
      })
    );

    this.subscriptions.add(
      this.interaction.isDetailDialogVisible$.subscribe(visible => {
        this.ngZone.run(() => {
          this.detailDialogVisible = visible;
        });
      })
    );
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['floors']) {
      this.updateFloorOptions();
    }
    if (!this.isInitialized) {
      this.initializeSceneIfNeeded();
    }
    if (!this.isInitialized) return;
    if (changes['floorData'] && this.floorData) {
      this.threeScene.setGroundPlaneColor(this.floorData.color ?? 0xf5f5f5);
      this.reloadFloorPlan();
      this.interaction.initialize(this.floorData);
    }
    if (changes['panToTarget']) {
      const selection = changes['panToTarget'].currentValue;
      if (selection) {
        this.warpPlayerTo(selection);
        this.panCameraToObject(selection);
        this.ngZone.run(() => this.interaction.closeDetail());
      }
    }
  }

  ngAfterViewInit(): void {
    this.initializeSceneIfNeeded();
  }

  public onDialogHide(): void {
    this.interaction.closeDetail();
    if (this.playerControls.player) {
      this.cameraLookAtTarget.copy(this.playerControls.player.position);
    }
  }

  ngOnDestroy(): void {
    this.saveViewportState();
    this.isInitialized = false;
    this.playerControls.dispose();
    this.threeScene.destroy();
    this.floorBuilder.clearFloor();
    this.subscriptions.unsubscribe();
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
  }

  // --- UI Action Methods ---

  setView(view: any): void {
    const viewMode = view as 'iso' | 'top';
    if (this.currentView === viewMode) return;
    this.currentView = viewMode;
    this.snapCameraToTarget();
  }

  toggleView(): void {
    const nextView = this.currentView === 'iso' ? 'top' : 'iso';
    this.setView(nextView);
  }

  selectFloor(floorNumber: number): void {
    if (this.activeFloorValue === floorNumber) return;
    this.floorChange.emit(floorNumber);
    if (this.floorPopover) {
      this.floorPopover.dismiss();
    }
  }

  toggleFullscreen(): void {
    this.saveViewportState();
    this.fullscreenChange.emit(!this.fullscreenContext);
  }

  get canZoomIn(): boolean {
    return this.currentZoomLevel < this.maxZoomLevel;
  }

  get canZoomOut(): boolean {
    return this.currentZoomLevel > this.minZoomLevel;
  }

  toggleJoystickVisibility(): void {
    this.isJoystickVisible = !this.isJoystickVisible;
  }

  adjustCameraZoom(direction: 'in' | 'out'): void {
    const delta = direction === 'in' ? this.zoomStep : -this.zoomStep;
    const nextZoom = Math.min(this.maxZoomLevel, Math.max(this.minZoomLevel, this.currentZoomLevel + delta));
    if (nextZoom === this.currentZoomLevel) return;
    this.currentZoomLevel = nextZoom;
    this.threeScene.camera.zoom = this.currentZoomLevel;
    this.threeScene.camera.updateProjectionMatrix();
  }

  @HostListener('window:click', ['$event'])
  onClick(event: MouseEvent) {
    this.interaction.handleMouseClick(event, this.cameraLookAtTarget);
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    this.playerControls.setKeyboardInput(event.code, true);
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    this.playerControls.setKeyboardInput(event.code, false);
  }

  @HostListener('window:pointerup')
  onGlobalPointerUp(): void {
    if (!this.threeScene.controls) return;
    if (!this.threeScene.controls.enabled) {
      this.threeScene.controls.enabled = true;
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.threeScene.resize();
  }

  // --- Private Helpers ---

  private initializeSceneIfNeeded(): void {
    if (this.isInitialized) return;
    if (!this.floorData || !this.canvasRef?.nativeElement) return;

    this.isInitialized = true;

    this.threeScene.initialize(this.canvasRef.nativeElement);
    this.playerControls.initialize();
    this.interaction.initialize(this.floorData);
    this.threeScene.setGroundPlaneColor(this.floorData.color ?? 0xeeeeee);
    this.floorGroup = this.floorBuilder.buildFloor(this.floorData);
    this.threeScene.scene.add(this.floorGroup);
    this.snapCameraToTarget();
    this.startRenderingLoop();

    this.ngZone.runOutsideAngular(() => setTimeout(() => this.threeScene.resize(), 0));
    this.restoreViewportState();

    this.setupResizeObserver();
  }

  private setupResizeObserver(): void {
    if (this.resizeObserver || typeof window === 'undefined' || !('ResizeObserver' in window)) {
      return;
    }
    const hostElement = this.canvasRef.nativeElement?.parentElement as Element | null;
    if (!hostElement) {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.threeScene.resize());
    this.ngZone.runOutsideAngular(() => this.resizeObserver?.observe(hostElement));
  }

  private updateFloorOptions(): void {
    this.floorOptions = (this.floors ?? []).map(floor => ({
      label: floor.floorName || `ชั้น ${floor.floor}`,
      value: floor.floor
    }));
  }

  private startRenderingLoop(): void {
    this.threeScene.startRenderingLoop(() => {
      this.playerControls.update(this.interaction.permissionList$.value);
      this.interaction.checkPlayerZone();
      this.updateCameraPosition();
    });
  }

  private updateCameraPosition(): void {
    if (!this.playerControls.player) return;

    // ใช้ selectedObject$.value เพื่อตัดสินใจล็อกกล้อง
    if (!this.interaction.selectedObject$.value) {
      this.cameraLookAtTarget.copy(this.playerControls.player.position);
    }

    const cameraLookAt = this.cameraLookAtTarget;
    const targetCameraPos = new THREE.Vector3();
    if (this.currentView === 'iso') {
      targetCameraPos.copy(cameraLookAt).add(this.getIsoCameraOffset());
    } else {
      targetCameraPos.set(cameraLookAt.x, this.getTopCameraHeight(), cameraLookAt.z);
    }
    const lerpAlpha = 0.08;
    this.threeScene.camera.position.lerp(targetCameraPos, lerpAlpha);
    this.threeScene.controls.target.lerp(cameraLookAt, lerpAlpha);
  }

  private snapCameraToTarget(): void {
    if (!this.playerControls.player) return;
    const baseTarget = this.playerControls.player.position.clone();
    this.cameraLookAtTarget.copy(baseTarget);
    const cameraPosition = this.currentView === 'iso'
      ? baseTarget.clone().add(this.getIsoCameraOffset())
      : new THREE.Vector3(baseTarget.x, this.getTopCameraHeight(), baseTarget.z);
    this.threeScene.camera.position.copy(cameraPosition);
    this.threeScene.controls.target.copy(baseTarget);
  }

  private panCameraToObject(targetData: any): void {
    if (!targetData) return;
    if (targetData.center) {
      this.cameraLookAtTarget.x = targetData.center.x;
      this.cameraLookAtTarget.z = targetData.center.y;
    } else if (targetData.boundary) {
      this.cameraLookAtTarget.x = (targetData.boundary.min.x + targetData.boundary.max.x) / 2;
      this.cameraLookAtTarget.z = (targetData.boundary.min.y + targetData.boundary.max.y) / 2;
    }
  }

  private warpPlayerTo(targetData: any): void {
    if (!this.playerControls.player || !targetData?.center) return;
    const newPosition = new THREE.Vector3(
      targetData.center.x,
      this.playerControls.playerSize,
      targetData.center.y
    );
    this.playerControls.player.position.copy(newPosition);
    this.snapCameraToTarget();
  }

  private reloadFloorPlan(): void {
    this.interaction.setViewportState(null);
    this.ngZone.run(() => {
      this.interaction.currentZoneId$.next(null);
      this.interaction.closeDetail();
      this.playerPositionDisplaySubject.next('');
    });
    if (this.floorGroup) {
      this.threeScene.scene.remove(this.floorGroup);
      this.floorBuilder.clearFloor();
    }
    this.floorGroup = this.floorBuilder.buildFloor(this.floorData, this.interaction.permissionList$.value);
    this.threeScene.scene.add(this.floorGroup);
    if (this.playerControls.player) {
      this.playerControls.player.position.set(0, this.playerControls.playerSize, 0);
      this.snapCameraToTarget();
    }
    this.interaction.setPermissionList(this.interaction.permissionList$.value);
  }

  private saveViewportState(): void {
    if (!this.isInitialized) {
      return;
    }
    if (!this.playerControls.player || !this.threeScene.camera || !this.threeScene.controls) {
      return;
    }

    const payload: FloorplanViewportState = {
      view: this.currentView,
      playerPosition: {
        x: this.playerControls.player.position.x,
        y: this.playerControls.player.position.y,
        z: this.playerControls.player.position.z
      },
      cameraPosition: {
        x: this.threeScene.camera.position.x,
        y: this.threeScene.camera.position.y,
        z: this.threeScene.camera.position.z
      },
      cameraTarget: {
        x: this.threeScene.controls.target.x,
        y: this.threeScene.controls.target.y,
        z: this.threeScene.controls.target.z
      },
      zoom: this.threeScene.camera.zoom
    };

    this.interaction.setViewportState(payload);
  }

  private restoreViewportState(): void {
    const state = this.interaction.getViewportState();
    if (!state) {
      return;
    }

    this.currentView = state.view;

    if (this.playerControls.player) {
      this.playerControls.player.position.set(
        state.playerPosition.x,
        state.playerPosition.y,
        state.playerPosition.z
      );
    }

    this.cameraLookAtTarget.set(
      state.cameraTarget.x,
      state.cameraTarget.y,
      state.cameraTarget.z
    );

    this.threeScene.camera.position.set(
      state.cameraPosition.x,
      state.cameraPosition.y,
      state.cameraPosition.z
    );

    this.threeScene.controls.target.set(
      state.cameraTarget.x,
      state.cameraTarget.y,
      state.cameraTarget.z
    );

    this.currentZoomLevel = state.zoom;
    this.threeScene.camera.zoom = state.zoom;
    this.threeScene.camera.updateProjectionMatrix();
    this.threeScene.controls.update();
  }

  private getIsoCameraOffset(): THREE.Vector3 {
    const baseOffset = new THREE.Vector3(5.5, 5.2, 5.5);
    return baseOffset.multiplyScalar(this.CAMERA_DISTANCE_FACTOR);
  }

  private getTopCameraHeight(): number {
    return 28 * this.CAMERA_DISTANCE_FACTOR;
  }

}
