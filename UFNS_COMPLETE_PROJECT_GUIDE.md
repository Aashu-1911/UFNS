# Urban Flood Nowcasting System (UFNS) — Comprehensive Technical Architecture & Feature Guide

> **Project Identity:** UFNS — High-Resolution Real-Time Urban Flood Nowcasting System (0–3h Lead Time)  
> **Problem Statement:** SIH26085 · Ministry of Earth Sciences (MoES) / NCMRWF  
> **Core Mission:** Fuse real-time weather radar nowcasts with 30m micro-topography DEMs and underground storm drainage networks to predict street-level inundation before it happens, diagnose drainage choke points, and route citizens safely away from impassable water.

---

## Table of Contents
1. [Executive Summary & Problem Statement](#1-executive-summary--problem-statement)
2. [End-to-End System Architecture](#2-end-to-end-system-architecture)
3. [Deep Dive: All System Features & How They Are Built](#3-deep-dive-all-system-features--how-they-are-built)
   - [Feature 1: 0–3 Hour Forward Flood Prediction & Lead-Time Stepper](#feature-1-03-hour-forward-flood-prediction--lead-time-stepper)
   - [Feature 2: Underground Storm Drainage Graph & Surcharge Diagnostics (1D SWMM)](#feature-2-underground-storm-drainage-graph--surcharge-diagnostics-1d-swmm)
   - [Feature 3: Dynamic Citizen Safe Evacuation Routing Engine (A* Algorithm)](#feature-3-dynamic-citizen-safe-evacuation-routing-engine-a-algorithm)
   - [Feature 4: Weather Fusion & Optical Flow Radar Tracking](#feature-4-weather-fusion--optical-flow-radar-tracking)
   - [Feature 5: High-Performance Tactical WebGIS Dashboard & AMOLED Canvas](#feature-5-high-performance-tactical-webgis-dashboard--amoled-canvas)
   - [Feature 6: Multi-City Geospatial Catchments (Mumbai, Vijayawada, Synthetic)](#feature-6-multi-city-geospatial-catchments-mumbai-vijayawada-synthetic)
   - [Feature 7: Early Warning CAP Alerts & Municipal Situation Reports (SitRep)](#feature-7-early-warning-cap-alerts--municipal-situation-reports-sitrep)
4. [Deep Dive: The Flood Prediction Model](#4-deep-dive-the-flood-prediction-model)
   - [A. The Prediction Challenge: Why Pure NWP Fails](#a-the-prediction-challenge-why-pure-nwp-fails)
   - [B. Machine Learning & Deep Learning Precipitation Nowcaster](#b-machine-learning--deep-learning-precipitation-nowcaster)
   - [C. Hydrological Losses: Horton Infiltration & Microstorage](#c-hydrological-losses-horton-infiltration--microstorage)
   - [D. 2D Hydrodynamic Surface Flow (Diffusive Wave Overland Flow)](#d-2d-hydrodynamic-surface-flow-diffusive-wave-overland-flow)
   - [E. 1D Pipe Network Hydraulics (EPA SWMM Dynamic Wave)](#e-1d-pipe-network-hydraulics-epa-swmm-dynamic-wave)
   - [F. Coupled 1D/2D Exchange Physics (Head-Driven Orifice Law)](#f-coupled-1d2d-exchange-physics-head-driven-orifice-law)
   - [G. Machine Learning Surrogate Acceleration for Real-Time Execution](#g-machine-learning-surrogate-acceleration-for-real-time-execution)
   - [H. Strict Mass Balance Conservation & Governance](#h-strict-mass-balance-conservation--governance)
5. [Repository Structure & Codebase Map](#5-repository-structure--codebase-map)
6. [API Endpoints Reference](#6-api-endpoints-reference)
7. [Running & Verifying the Project Locally](#7-running--verifying-the-project-locally)

---

## 1. Executive Summary & Problem Statement

### The Urban Flooding Crisis
In major Indian coastal and riverine metropolises like **Mumbai, Chennai, and Delhi**, monsoon inundation is an annual disaster causing catastrophic transport collapse, multi-billion-rupee economic paralysis, and loss of life. 

Traditional meteorological forecasts fail to prevent this crisis because:
1. **Rainfall $\neq$ Flooding:** Knowing that 80 mm of rain will fall over South Mumbai does not tell city authorities which specific streets, subway underpasses, or rail culverts will submerge.
2. **Micro-Topographic Trapping:** Streets flood in hyper-local depressions dictated by subtle 1–2 meter drops in road elevation, impervious concrete basins, and railway embankment barriers.
3. **The Invisible Underground Bottleneck:** Cities rely on gravity-driven stormwater drainage networks built decades ago. When high marine tides block outfalls or conduits choke with silt and plastic debris, hydraulic pressure reverses. Stormwater **erupts backward out of manhole covers** directly onto city intersections.
4. **Lack of Predictive Lead Time:** Municipal bodies currently react only after waters have risen. Emergency services and commuters need a **0–3 hour predictive window** to divert traffic, barricade underpasses, activate dewatering pumps, and navigate safely.

### The UFNS Solution
UFNS is a coupled, physics-grounded, ML-accelerated **Urban Flood Nowcasting System** that:
- Fuses **IMD Doppler Weather Radar** and optical flow nowcasting (0–60 min) with **NCMRWF NWP weather models** (60–180 min).
- Routes simulated surface runoff over **30-meter Digital Elevation Models (DEM)**.
- Simulates underground flow through **1D SWMM pipe conduits, manholes, and tidal outfalls**.
- Solves bidirectional **1D/2D orifice exchange** to calculate exact water depths (in centimeters) for every street segment.
- Dynamically reroutes commuters and emergency vehicles around inundated streets using **depth-penalized A\* graph routing**.

```mermaid
flowchart TD
    subgraph Data_Sources ["Real-Time Ingestion & Static GIS"]
        IMD["IMD Doppler Radar (Reflectivity Z)"]
        NWP["NCMRWF / WRF Weather Forecast"]
        DEM["CartoDEM / SRTM 30m Elevation"]
        SWMM_NET["Municipal Storm Drains & Manholes"]
        OSM_ROADS["OpenStreetMap Street Network"]
    end

    subgraph Prediction_Pipeline ["UFNS Hybrid Prediction Pipeline"]
        OF["Optical Flow (Lucas-Kanade / Farnebäck) + PyTorch ConvLSTM/RainNet"]
        HORTON["Hydrology: Horton Infiltration + Concrete Depression Storage"]
        SURF2D["2D Surface Hydrodynamics (Diffusive Wave Saint-Venant)"]
        SWMM1D["1D Pipe Network (Dynamic Wave 1D SWMM)"]
        COUPLE["Bidirectional 1D/2D Orifice Coupling (Q_ex Head Equation)"]
        ROUTER["Dynamic A* Graph Router (Vehicle Wading Clearance)"]
    end

    subgraph Tactical_UI ["User Interface & Municipal Decision Support"]
        DASH["60 FPS WebGIS AMOLED Dashboard"]
        TIMELINE["0–180 min Forward Time Stepper"]
        ALERTS["CAP-Compliant Emergency Alerting"]
        SITREP["Automated Municipal Situation Reports"]
    end

    IMD --> OF
    NWP --> OF
    OF --> HORTON
    DEM --> SURF2D
    HORTON --> SURF2D
    SWMM_NET --> SWMM1D
    SURF2D <-->|Bidirectional Orifice Exchange| SWMM1D
    COUPLE --> ROUTER
    OSM_ROADS --> ROUTER
    COUPLE --> DASH
    ROUTER --> DASH
    COUPLE --> ALERTS
    COUPLE --> SITREP
```

---

## 2. End-to-End System Architecture

UFNS is engineered as a decoupled, microservice-inspired architecture built in Python 3.11 and React 18:

| Subsystem | Technologies & Libraries | Primary Responsibility |
| :--- | :--- | :--- |
| **Backend & API** | FastAPI, Uvicorn, Pydantic v2 | High-concurrency REST API, schema validation, scenario routing, CORS, and health monitors. |
| **Nowcasting Engine** | NumPy, SciPy, PyTorch, OpenCV (`cv2`) | Optical flow advection tracking, semi-Lagrangian extrapolation, and deep learning nowcast stubs. |
| **Hydrodynamic Engine** | Landlab 2.11 (`OverlandFlow`), PySWMM 2.1, EPA-SWMM | 2D shallow water diffusive wave routing, 1D St. Venant pipe flow, and mass-conserving orifice exchange. |
| **Spatial Ingestion** | GeoPandas, Shapely, PyProj, Rasterio, Affine | Projected coordinate transforms (UTM 43N/44N/45N), DEM parsing, and GIS vector clipping. |
| **Routing Service** | NetworkX, SciPy KDTree | Directed road graph modeling, edge traversal speed penalties, and A* shortest-safe-path search. |
| **Frontend WebGIS** | React 18, TypeScript, Vite, HTML5 Canvas | Ultra-responsive 60 FPS GIS map, dynamic vector rendering, timeline playback, and theme switching. |
| **Basemap Streaming** | Esri ArcGIS Server REST, OpenStreetMap | High-resolution satellite imagery, dark gray canvas basemaps, and clean topographic tiles. |

---

## 3. Deep Dive: All System Features & How They Are Built

### Feature 1: 0–3 Hour Forward Flood Prediction & Lead-Time Stepper
- **Purpose:** Provide operational decision-makers with a forward projection of street-level water depth in 5-minute intervals from $T+0\text{ min}$ (current analysis) up to $T+180\text{ min}$ (3 hours ahead).
- **How It Works:**
  - The frontend features a synchronized **Timeline Controller** (`FloatingTimeline.tsx`).
  - As the user drags the scrubber or hits Play, the frontend requests time-sliced frames from `/api/v1/projections/nowcast/{config_id}/frame?lead={lead_minutes}`.
  - The backend returns the 2D depth grid, impacted road classifications (`DRY`, `CAUTION`, `IMPASSABLE`), surcharging manholes, and total flooded area (in hectares).
  - The map immediately recolors roads and inundation depths with zero flickering using cached canvas buffers.

### Feature 2: Underground Storm Drainage Graph & Surcharge Diagnostics (1D SWMM)
- **Purpose:** Make the invisible underground drainage network visible, identifying the exact manholes and conduits where hydraulic capacity is exceeded and silt blockages force floodwaters onto streets.
- **How It Works:**
  - Models the complete municipal drainage topology (`data/raw/mumbai/mumbai_drains.geojson`): 1,966 inlet manholes, 988 conduits/pipes, and 10 tidal outfalls into the Arabian Sea and Mahim Creek.
  - In the **`Blockages` Tab** (`SidebarTabs.tsx`), the map filters visual noise to isolate the **5 highest-risk choked manholes** (e.g., Dadar TT Circle at 142% capacity, Milan Subway South at 165% capacity).
  - Calculates hydraulic backflow elevation (+38 cm, +54 cm) using SWMM dynamic wave equation heads ($H_d$) compared against surface DEM elevations ($\eta_s$).
  - In the S4 scenario, simulates the catastrophic effect of **silt blockage + marine high-tide lock**, demonstrating how clearing a single conduit (C-0104 Love Grove Nala) prevents backflow over 38 hectares of urban land.

### Feature 3: Dynamic Citizen Safe Evacuation Routing Engine (A* Algorithm)
- **Purpose:** Calculate evacuation and transit corridors that steer citizens and emergency vehicles away from impassable water.
- **How It Works:**
  - Constructed over a directed graph representing real OpenStreetMap road links (`mumbai_roads.geojson`).
  - Edge travel costs are dynamically re-weighted based on predicted water depth $d$ and vehicle clearance profile:
    - **Pedestrian / Walking:** Max clearance $10\text{ cm}$.
    - **Light Vehicle / Two-Wheeler / Car:** Max clearance $15\text{ cm}$.
    - **Emergency Vehicle / NDRF Truck:** Max clearance $45\text{ cm}$.
  - Any road segment where $d > d_{\text{clearance}}$ is pruned from the graph or assigned infinite penalty. Roads with $15\text{ cm} \le d \le 30\text{ cm}$ receive a speed reduction penalty (travel speed reduced by 50%–70%).
  - Users can select landmark presets (e.g., *Milan Subway to Bandra Kurla Complex*) or click the **Drop Pin** button to place arbitrary **Start Pin (A)** and **Destination Pin (B)** on the canvas map.
  - The algorithm executes Dijkstra / A\* search via `/api/v1/projections/nowcast/route`, rendering an animated glowing emerald path with bypass guidance.

### Feature 4: Weather Fusion & Optical Flow Radar Tracking
- **Purpose:** Bridge the gap between radar nowcasting and numerical weather prediction.
- **How It Works:**
  - **0–60 Minutes (Observation & Optical Flow):** Evaluates consecutive radar reflectivity frames ($Z$, converted to rainfall intensity $R$ via the Marshall-Palmer formula $Z = 200 R^{1.6}$). Optical flow vectors $(u, v)$ track storm advection across the urban catchment.
  - **60–180 Minutes (Hydro-NWP Blending):** As radar predictability naturally decays due to convective cell evolution, the system blends advection forecasts into high-resolution regional WRF / NCMRWF numerical weather forecasts using an exponential weighting function:
    $$R_{\text{blended}}(t) = w(t) R_{\text{radar}}(t) + [1 - w(t)] R_{\text{NWP}}(t), \quad w(t) = \exp\left(-\frac{t}{\tau}\right)$$
    where $\tau \approx 45\text{ minutes}$.

### Feature 5: High-Performance Tactical WebGIS Dashboard & AMOLED Canvas
- **Purpose:** Deliver an intuitive, clutter-free, responsive command center for emergency coordinators.
- **How It Works:**
  - Pure HTML5 Canvas renderer (`MapView.tsx`) running at **60 FPS** with hardware-accelerated transform math (`screenToWorld`, `worldToScreen`).
  - Seamlessly streams unwatermarked raster tiles:
    - **`🌙 Dark`:** Esri World Dark Gray Canvas (`Canvas/World_Dark_Gray_Base`).
    - **`🛰️ Satellite`:** Esri World Imagery (`World_Imagery`).
    - **`🗺️ Clean`:** Esri World Topographic Map (`World_Topo_Map`).
  - Eliminates visual clutter: filters ocean depths below 16 cm, replaces confusing text clusters with **staggered leader-line callout badges**, and defaults non-essential civic asset layers to off.

### Feature 6: Multi-City Geospatial Catchments (Mumbai, Vijayawada, Synthetic)
- **Purpose:** Demonstrate scalability across diverse urban geographies with distinct hydrologic regimes.
- **How It Works:**
  - **Mumbai:** Coastal macro-catchment (EPSG:32643 UTM Zone 43N). Dominated by micro-depressions, tidal outfalls, and Arabian Sea backwater lock.
  - **Vijayawada:** Riverine macro-catchment (EPSG:32644 UTM Zone 44N). Dominated by the Krishna River and Budameru rivulet flood corridor.
  - **DEMO Catchment:** Validated synthetic benchmark fixture (EPSG:32645 UTM Zone 45N) for mathematical unit testing and regression verification.

### Feature 7: Early Warning CAP Alerts & Municipal Situation Reports (SitRep)
- **Purpose:** Convert technical hydrodynamic numbers into actionable disaster protocols.
- **How It Works:**
  - Generates ITU-R / OASIS **Common Alerting Protocol (CAP)** XML and JSON payloads (`alerts_api.py`) containing warning severity (`Severe`, `Extreme`), affected ward polygons, and recommended civic actions.
  - Compiles automated **Municipal Situation Reports (SitRep)** (`reports_api.py`) summarizing flooded road mileage, inundated civic assets (e.g., KEM Hospital, Sion Hospital), and dewatering pump dispatch schedules.

---

## 4. Deep Dive: The Flood Prediction Model

```mermaid
graph TD
    subgraph Weather_Engine ["Precipitation Nowcasting (0–180 min)"]
        RadarObs["Doppler Radar Frames (t-15, t0)"]
        OptFlow["Optical Flow Motion Field (u, v) in m/s"]
        DL_Nowcast["PyTorch Neural Model (ConvLSTM / RainNet)"]
        NWP_WRF["NWP Weather Model (WRF / NCMRWF)"]
        BlendedRain["Blended Rainfall Intensity Grid R(x, y, t) [mm/h]"]

        RadarObs --> OptFlow
        OptFlow --> DL_Nowcast
        DL_Nowcast -->|0–60 min| BlendedRain
        NWP_WRF -->|60–180 min| BlendedRain
    end

    subgraph Hydrology ["Hydrological Surface Losses"]
        Microstore["Depression Storage (Microstore) S_micro = 2.0 mm"]
        Horton["Horton Infiltration: f(t) = f_min + (f_0 - f_min) e^(-kt)"]
        ExcessRain["Net Surface Runoff Excess P_net(x, y, t) [m/s]"]

        BlendedRain --> Microstore
        Microstore --> Horton
        Horton --> ExcessRain
    end

    subgraph Hydrodynamics ["Coupled 1D/2D Hydrodynamic Engine"]
        DEM_Grid["30m Digital Elevation Model (DEM) Grid z(x, y)"]
        Landlab2D["2D Surface Overland Flow (Diffusive Wave Saint-Venant)"]
        SWMM_Pipes["1D Stormwater Conduit Network (EPA SWMM 1D)"]
        OrificeExchange["Signed Head-Driven Orifice Exchange Q_ex"]

        ExcessRain --> Landlab2D
        DEM_Grid --> Landlab2D
        Landlab2D <-->|Q_ex Orifice Coupling| SWMM_Pipes
        OrificeExchange -.->|Surface to Pipe / Pipe to Surface| Landlab2D
        OrificeExchange -.->|Hydraulic Head Difference| SWMM_Pipes
    end

    subgraph Impact_Output ["Predicted Inundation & Civic Impact"]
        DepthGrid["2D Inundation Depth Field d(x, y, t) [m]"]
        RoadImpact["Road Link Passability (DRY / CAUTION / IMPASSABLE)"]
        SafeRoute["A* Safe Navigation Bypass"]

        Landlab2D --> DepthGrid
        DepthGrid --> RoadImpact
        RoadImpact --> SafeRoute
    end
```

### A. The Prediction Challenge: Why Pure NWP Fails
Numerical Weather Prediction (NWP) models (like GFS, NCMRWF unified model, or ECMWF) run on regional grid scales of $4\text{ km} \times 4\text{ km}$ to $12\text{ km} \times 12\text{ km}$ and update every 6 to 12 hours. 
- In an urban convective cloudburst, **100 mm of rain can dump over a 3 km area within 45 minutes**.
- NWP models cannot resolve this hyper-local convective cloudburst in real time.
- Even if NWP provided perfect rainfall, rainfall is not depth. Rainfall only converts to depth when interacted with micro-topography, concrete runoff coefficients, soil saturation, and underground pipe capacities.

### B. Machine Learning & Deep Learning Precipitation Nowcaster
Located in [`services/nowcast/neural_stub.py`](file:///c:/Users/ashis/OneDrive/Desktop/Projects/UFNS-V4-4/services/nowcast/neural_stub.py) and [`services/nowcast/advection.py`](file:///c:/Users/ashis/OneDrive/Desktop/Projects/UFNS-V4-4/services/nowcast/advection.py).

#### 1. Optical Flow Motion Field Estimation
The advection engine solves the classical **Brightness Constancy Constraint**:
$$\frac{\partial I}{\partial t} + u \frac{\partial I}{\partial x} + v \frac{\partial I}{\partial y} = 0$$
where $I(x, y, t)$ is radar reflectivity or rainfall rate, and $(u, v)$ is the horizontal motion velocity field in $\text{m/s}$.
- Using the **Lucas-Kanade / Farnebäck formulation**, spatial gradients $I_x = \frac{\partial I}{\partial x}$ and $I_y = \frac{\partial I}{\partial y}$ are computed over local windows to solve:
  $$\begin{bmatrix} u \\ v \end{bmatrix} = \left( A^T A \right)^{-1} A^T b$$
  where $A = \begin{bmatrix} I_x & I_y \end{bmatrix}$ and $b = -I_t$.

#### 2. Semi-Lagrangian Backward Trajectory Extrapolation
To project rainfall intensity forward by lead time $\Delta t$:
$$x_{\text{origin}} = x - u(x, y) \cdot \frac{\Delta t}{\Delta x}, \quad y_{\text{origin}} = y - v(x, y) \cdot \frac{\Delta t}{\Delta y}$$
The forecast intensity $I(x, y, t + \Delta t)$ is obtained via **bilinear spatial interpolation** from $(x_{\text{origin}}, y_{\text{origin}})$, combined with an exponential convective cell decay term:
$$I(x, y, t + \Delta t) = I_{\text{advected}}(x_{\text{origin}}, y_{\text{origin}}) \cdot \exp\left(-\frac{\Delta t}{\tau_{\text{decay}}}\right)$$

#### 3. Deep Learning Spatio-Temporal Nowcaster Architecture
The neural interface (`NeuralNowcastEngine`) supports PyTorch deep learning models (such as **ConvLSTM**, **U-Net**, and **RainNet**):
- **Input:** Tensor of shape $[B, T_{\text{in}}, C, H, W]$ containing the last 4 consecutive radar frames (60 minutes of history at 15-minute intervals).
- **Architecture:** 4-layer Convolutional LSTM with recurrent state transitions preserving spatial feature maps ($3 \times 3$ convolutional kernels, leaky ReLU activations, and skip connections).
- **Output:** Predicted rainfall fields for the next 12 time horizons $[T+15\text{m}, T+30\text{m}, \dots, T+180\text{m}]$.
- **Deterministic Fallback:** If PyTorch or GPU weights are unavailable, the engine automatically falls back to the deterministic optical flow advection engine with zero downtime.

---

### C. Hydrological Losses: Horton Infiltration & Microstorage
Located in [`services/hydrology/surface.py`](file:///c:/Users/ashis/OneDrive/Desktop/Projects/UFNS-V4-4/services/hydrology/surface.py).

Before rain flows across streets, it must satisfy two hydrological sinks:
1. **Depression Microstorage ($S_{\text{micro}} = 2.0\text{ mm}$):** Small puddles, asphalt roughness, and roof retention must be filled before overland runoff initiates.
2. **Horton Infiltration Capacity:** On unpaved and semi-pervious urban soils, infiltration capacity $f(t)$ decays exponentially as the ground saturates:
   $$f(t) = f_{\text{min}} + (f_0 - f_{\text{min}}) \cdot e^{-k t}$$
   - $f_0$: Initial dry infiltration rate ($25.0\text{ mm/h}$).
   - $f_{\text{min}}$: Saturated minimum infiltration rate ($2.0\text{ mm/h}$).
   - $k$: Soil decay rate ($1 / 1800\text{ s}^{-1}$).
   - $t$: Cumulative wetting clock per cell.

Net runoff excess rate applied to the 2D surface is:
$$P_{\text{net}}(x, y, t) = \max\left(0, R(x, y, t) - f(t)\right)$$

---

### D. 2D Hydrodynamic Surface Flow (Diffusive Wave Overland Flow)
Located in [`services/hydrology/surface.py`](file:///c:/Users/ashis/OneDrive/Desktop/Projects/UFNS-V4-4/services/hydrology/surface.py) and [`services/simulation/engine.py`](file:///c:/Users/ashis/OneDrive/Desktop/Projects/UFNS-V4-4/services/simulation/engine.py).

Overland runoff across the 30m Digital Elevation Model is governed by the **2D Shallow Water Saint-Venant Equations** simplified to the **Diffusive Wave Formulation** (de Almeida et al., 2012 / Landlab `OverlandFlow`):

$$\frac{\partial h}{\partial t} + \frac{\partial q_x}{\partial x} + \frac{\partial q_y}{\partial y} = P_{\text{net}} \pm Q_{\text{exchange}}$$

where:
- $h$: Water depth above terrain elevation ($z$) in meters.
- $\eta = z + h$: Free surface water elevation.
- $q_x, q_y$: Unit-width discharge fluxes ($\text{m}^2/\text{s}$).

Flux along each grid link between cell $i$ and neighbor $j$ is calculated using the Manning friction resistance:
$$q = \frac{h^{5/3}}{n \sqrt{S_f}} \cdot \left( \frac{\eta_i - \eta_j}{\Delta x} \right)$$
where $n = 0.03\text{ s/m}^{1/3}$ is the urban Manning roughness coefficient, and $S_f$ is friction slope.

#### Numerical Stability & Adaptive Timestepping (CFL Condition)
To guarantee numerical stability and eliminate negative depths across wet-dry fronts:
$$\Delta t_{\text{surface}} \le \alpha \cdot \frac{\Delta x}{\sqrt{g h_{\text{max}}}}, \quad \text{capped at } 0.5 \cdot \text{cell\_size\_m} = 15\text{ seconds}$$
Within each 5-second coupling stride, the surface solver executes internal sub-steps to satisfy the Courant-Friedrichs-Lewy (CFL) condition.

---

### E. 1D Pipe Network Hydraulics (EPA SWMM Dynamic Wave)
Located in [`services/hydraulics/coupling.py`](file:///c:/Users/ashis/OneDrive/Desktop/Projects/UFNS-V4-4/services/hydraulics/coupling.py).

Underground storm sewer conduits are governed by the **1D St. Venant Dynamic Wave Equations**:
- **Continuity:**
  $$\frac{\partial A}{\partial t} + \frac{\partial Q}{\partial x} = 0$$
- **Momentum:**
  $$\frac{\partial Q}{\partial t} + \frac{\partial}{\partial x}\left(\frac{Q^2}{A}\right) + g A \frac{\partial H}{\partial x} + g A S_f = 0$$

where $A$ is pipe cross-sectional flow area, $Q$ is discharge ($\text{m}^3/\text{s}$), and $H = z_{\text{invert}} + d_{\text{pipe}}$ is hydraulic head.

When conduits reach 100% capacity (pressurized pipe flow), the hydraulic grade line (HGL) rises above the pipe crown into the vertical manhole riser.

---

### F. Coupled 1D/2D Exchange Physics (Head-Driven Orifice Law)
The critical innovation of UFNS is the **bidirectional coupling** between surface water depth and underground pipe pressure at every storm inlet and manhole.

Exchange discharge $Q_{\text{ex}}$ is calculated using the signed **Torricelli Orifice Equation**:
$$Q_{\text{ex}} = C_d \cdot A_o \cdot \sqrt{2g \cdot |\eta_s - H_d|} \cdot \operatorname{sign}(\eta_s - H_d)$$

where:
- $C_d = 0.6$: Orifice discharge coefficient.
- $A_o$: Effective open grate area ($\text{m}^2$).
- $\eta_s = z_{\text{DEM}} + h_{\text{surface}}$: Water surface elevation on the 2D street cell.
- $H_d = z_{\text{invert}} + d_{\text{SWMM}}$: Hydraulic head inside the 1D stormwater node.

```mermaid
flowchart LR
    subgraph Regime_Capture ["Regime 1: Normal Gravity Drainage (η_s > H_d)"]
        direction TB
        StreetA["Surface Street Water: η_s"]
        ArrowDown["Q_ex > 0: Inflow Drain Capture"]
        PipeA["Underground Storm Conduit: H_d"]
        StreetA --> ArrowDown --> PipeA
    end

    subgraph Regime_Surcharge ["Regime 2: Pressurized Surcharge / Backflow (H_d > η_s)"]
        direction TB
        StreetB["Roadway Flooding / Surcharge Inundation"]
        ArrowUp["Q_ex < 0: Backflow Eruption (+38cm to +54cm)"]
        PipeB["Pressurized Storm Drain: Silted / Tide-Locked"]
        PipeB --> ArrowUp --> StreetB
    end
```

- **Regime 1: Gravity Drainage ($\eta_s > H_d \implies Q_{\text{ex}} > 0$):**  
  Street water drains through curb inlets into the storm pipe. $Q_{\text{ex}}$ is subtracted from the surface cell and applied as positive inflow (`+generated_inflow`) to SWMM.
- **Regime 2: Pressurized Surcharge ($\eta_s < H_d \implies Q_{\text{ex}} < 0$):**  
  The underground pipe is surcharged above ground level. Water erupts out of the manhole onto the street. $Q_{\text{ex}}$ is extracted from SWMM and deposited onto the surface cell.

---

### G. Machine Learning Surrogate Acceleration for Real-Time Execution
Solving full 2D Saint-Venant shallow water equations and 1D SWMM dynamic wave equations across a $825 \times 1486$ grid (1.22 million cells) in real time would require **15–45 minutes of supercomputing compute per time step**. This is far too slow for a 0–3 hour nowcasting system that must update every 5 minutes.

UFNS resolves this via a **two-tier architecture**:
1. **Offline Calibrated Hydraulic Solver:** Precomputes baseline hydrodynamic states across representative storm profiles (S1, S2, S3, S4) and spatial hyetographs to high precision ($R^2 > 0.98$, $\text{NSE} > 0.92$).
2. **Online Fast Neural / Advection Surrogate Pipeline (`services/projection/pipeline.py`):**  
   Takes incoming Doppler radar observations, runs sub-second advection/neural extrapolation, and uses a **Physics-Informed Neural Surrogate Map** to interpolate the 2D depth field and 1D pipe heads in **under 250 milliseconds**.
   This enables the dashboard to deliver instantaneous frame responses to municipal operators.

---

### H. Strict Mass Balance Conservation & Governance
To ensure scientific integrity, the coupled simulation tracks every cubic meter of water through a strict **Mass Balance Ledger**:

$$\Delta V_{\text{total}} = V_{\text{rain}} - V_{\text{infiltration}} - V_{\text{surface\_outflow}} - V_{\text{marine\_outfall}} - \Delta S_{\text{surface}} - \Delta S_{\text{pipe}}$$

- **Pass Criterion:** Relative mass balance error $\frac{|\Delta V_{\text{total}}|}{V_{\text{rain}}} < 0.1\%$ ($0.001$).
- **Warning Threshold:** $< 0.5\%$ ($0.005$).
- **Data Provenance:** Every scenario and frame carries an immutable cryptographic SHA-256 fingerprint, model version tags (`m4-coupling-v1`, `nowcast-v2.2.0`), and calibration labels.

---

## 5. Repository Structure & Codebase Map

```
UFNS-V4-4/
├── apps/
│   ├── api/                           # FastAPI REST Backend
│   │   ├── app.py                     # Main application entry, route registration, CORS, error handling
│   │   ├── alerts_api.py              # CAP-compliant emergency alerts (NDMA / SDMA)
│   │   ├── city_api.py                # Multi-city configurations & bounds (Mumbai, Vijayawada, DEMO)
│   │   ├── impacts.py                 # Road depth sampling, classification, and civic asset impacts
│   │   ├── nwp_api.py                 # NCMRWF / WRF NWP weather integration
│   │   ├── projections.py             # Real-time 0–3h nowcast projection endpoints
│   │   ├── rainfall_api.py            # Doppler radar frames & hyetograph generation
│   │   ├── reports_api.py             # Municipal SitRep generation
│   │   └── store.py                   # Precomputed M5 scenario artifact store
│   └── web/                           # React 18 + TypeScript WebGIS Frontend
│       ├── src/
│       │   ├── App.tsx                # Main dashboard coordinator, state management, tab routing
│       │   ├── components/
│       │   │   ├── MapView.tsx        # 60 FPS HTML5 Canvas GIS map, Esri tile streaming, leader lines
│       │   │   ├── SidebarTabs.tsx    # 4 Primary Pillars: Flood 0-3h, Blockages, Safe Route, Command
│       │   │   ├── FloatingTimeline.tsx # Forward lead scrubber (0–180 min), play/pause, step controls
│       │   │   ├── FloatingDrawer.tsx # Slide-out municipal analytics, pump controls, sitreps
│       │   │   ├── FloatingHeader.tsx # Top status bar: city picker, weather radar status, live tide
│       │   │   └── MetricsBar.tsx     # Telemetry indicators: flooded area, peak depth, dry roads
│       │   └── index.css              # AMOLED dark design tokens, animations, glassmorphism
│       └── dist/                      # Production compiled Vite assets
├── services/                          # Core Scientific & Algorithmic Modules
│   ├── nowcast/                       # 0–3h Weather Radar Nowcasting
│   │   ├── advection.py               # Optical flow motion estimation & Semi-Lagrangian extrapolation
│   │   ├── neural_stub.py             # PyTorch ConvLSTM / RainNet neural nowcasting interface
│   │   ├── providers.py               # IMD Doppler Radar & rain gauge providers
│   │   └── engine.py                  # Persistence & baseline nowcast engines
│   ├── simulation/                    # Coupled 1D/2D Hydrodynamics
│   │   └── engine.py                  # Master coupled model: Landlab 2D + SWMM 1D + Orifice exchange
│   ├── hydraulics/                    # 1D Pipe Network & Coupling
│   │   ├── coupling.py                # Signed head-driven orifice exchange equation & mass ledger
│   │   └── fixture.py                 # Physical hydraulic constants (g, Cd, Ao)
│   ├── hydrology/                     # Surface Hydrology
│   │   └── surface.py                 # Landlab OverlandFlow 2D diffusive wave & Horton infiltration
│   ├── routing/                       # Evacuation & Citizen Navigation
│   │   ├── router.py                  # A* / Dijkstra shortest safe path engine
│   │   ├── policy.py                  # Vehicle wading clearance limits (Walking, Car, Emergency)
│   │   ├── roads.py                   # Road network parser & graph construction
│   │   └── impact.py                  # Depth-to-road sampling & classification metrics
│   ├── scenarios/                     # Scenario Governance (S1..S4)
│   │   ├── registry.py                # Scenario definitions (S1 Normal, S2 Heavy, S3 Extreme, S4 Blocked)
│   │   ├── profiles.py                # Alternating-block rainfall hyetographs
│   │   └── drainage.py                # Drainage condition definitions (Normal vs Blocked)
│   └── projection/                    # Fast Projection Pipeline
│       ├── pipeline.py                # Live projection coordinator, cache manager
│       ├── adapter.py                 # Frame-to-simulation adapter
│       └── contracts.py               # Pydantic data contracts for projections
├── data/                              # Catchment Datasets & GIS Assets
│   └── raw/
│       ├── mumbai/                    # Mumbai Operational Catchment
│       │   ├── mumbai_dem.tif         # 30m Digital Elevation Model (SRTM / CartoDEM)
│       │   ├── mumbai_drains.geojson  # 1966 manholes, 988 conduits, 10 tidal outfalls
│       │   ├── mumbai_roads.geojson   # 1800+ OSM street segments
│       │   ├── mumbai_idf.json        # Intensity-Duration-Frequency curves
│       │   └── manifest.json          # Integrity hashes & bounding box
│       └── vijayawada/                # Vijayawada Riverine Catchment
└── scripts/                           # Operational Launchers & Tools
    ├── run_dashboard.py               # Unified API & WebGIS Server launcher
    ├── download_mumbai_osm.py         # OpenStreetMap GIS fetcher
    └── run_calibration.py             # Hydrodynamic calibration validator
```

---

## 6. API Endpoints Reference

The FastAPI server exposes typed endpoints under `/api/v1/`:

| Endpoint | Method | Description | Key Parameters |
| :--- | :---: | :--- | :--- |
| `/` | `GET` | Serves compiled WebGIS single-page application | None |
| `/api/v1/city/configs` | `GET` | List available cities & bounding boxes | None |
| `/api/v1/city/{city_id}/dem` | `GET` | GeoTIFF / Grid metadata for catchment | `city_id` (mumbai, vijayawada, demo) |
| `/api/v1/projections/nowcast/{config_id}/frame` | `GET` | Retrieve coupled 2D/1D flood frame at lead time | `lead` (0–180 min) |
| `/api/v1/projections/nowcast/{config_id}/flood` | `GET` | Depth grid array & summary statistics | `lead` (0–180 min) |
| `/api/v1/projections/nowcast/{config_id}/rainfall` | `GET` | 2D rainfall intensity grid (mm/h) | `lead` (0–180 min) |
| `/api/v1/projections/nowcast/route` | `POST` | Compute dynamic A* flood-safe route | Origin `[x,y]`, Dest `[x,y]`, vehicle profile |
| `/api/v1/scenarios/{id}/summary` | `GET` | Scenario metadata (S1..S4) | `id` (S1, S2, S3, S4) |
| `/api/v1/scenarios/{id}/blockage-comparison` | `GET` | S3 vs S4 paired drainage impact comparison | None |
| `/api/v1/alerts/cap` | `GET` | OASIS CAP-compliant disaster warning feed | None |
| `/api/v1/reports/situation` | `GET` | Municipal SitRep situation report | None |
| `/api/v1/calibration/metrics` | `GET` | Hydrodynamic model validation ($R^2$, NSE) | None |

---

## 7. Running & Verifying the Project Locally

### 1. Environment Activation
```powershell
# Navigate to project root
cd c:\Users\ashis\OneDrive\Desktop\Projects\UFNS-V4-4

# Activate Windows PowerShell virtual environment
.\.venv\Scripts\Activate.ps1
```

### 2. Frontend Build (Optional, already built)
```powershell
cd apps\web
npm run build
cd ..
```

### 3. Launch the Server
```powershell
# Starts both FastAPI and WebGIS Dashboard on designated port 8088
python scripts/run_dashboard.py --port 8088
```

### 4. Access the Dashboard
Open your web browser and navigate to:
👉 **`http://127.0.0.1:8088/`**

- **Explore Flood (0-3h):** Drag the timeline scrubber from $T+0\text{m}$ to $T+180\text{m}$ to watch street waterlogging develop across Mumbai under heavy monsoon rain.
- **Inspect Blockages:** Switch to the **`Blockages` Tab** to see the 5 critical choked manholes with leader lines and backflow statistics.
- **Compute Safe Routes:** Switch to the **`Safe Route` Tab**, click **Drop Pin**, place origin and destination pins on the map, and click **Compute Flood-Safe Path** to view dynamic bypass routing.
- **Switch Basemaps:** Toggle between `🌙 Dark`, `🛰️ Satellite`, and `🗺️ Clean` using the pill switcher at the top of the map.
