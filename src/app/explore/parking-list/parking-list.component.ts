import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-parking-list',
  templateUrl: './parking-list.component.html',
  styleUrls: ['./parking-list.component.scss'],
  standalone: true,
  imports: [CommonModule],
})
export class ParkingListComponent  implements OnInit {

  constructor() { }

  ngOnInit() {}

}
