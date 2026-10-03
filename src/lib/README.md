# Smart Attendance Management System

A web-based attendance management system designed for colleges to simplify attendance tracking, face-based attendance, analytics, and student attendance recovery.

Built as an 8-hour college hackathon project.

## Features

### Teacher / Admin
- Dashboard with attendance overview
- Manual attendance
- Face recognition attendance
- Face enrollment
- Student management
- Attendance analytics
- Attendance reports
- Low-attendance detection
- Attendance Recovery Planner
- What-If attendance simulator
- Guardian absence notifications

### Student
- Student login
- Personal attendance overview
- Present / late / absent statistics
- Attendance history
- 75% attendance status
- Recovery planning
- What-If attendance simulation
- Read-only access

## ⭐ Key Feature — Attendance Recovery Planner

Instead of simply showing that a student has low attendance, the system calculates how many consecutive classes the student needs to attend to reach the required attendance threshold.

It also allows students and teachers to simulate future scenarios:

- What happens if the student attends the next 1, 2, or 3 classes?
- What happens if the student misses them?
- How many classes are required to recover?

The calculations are deterministic and based on the student's actual attendance data.

## Guardian Notifications

When a student is marked absent, the system can generate an in-app guardian notification containing the student's attendance event and available guardian contact information.

Guardian contact details are managed by the teacher/admin.

> Current implementation uses demo/in-app notifications rather than a real SMS or WhatsApp service.

## Tech Stack

- HTML
- CSS
- JavaScript
- Node.js
- Git
- GitHub
- Face recognition models

## Development

This project was developed using AI-assisted coding alongside manual testing, debugging, feature design, Git version control, and iterative development.

## Project Status

Hackathon prototype / MVP.

The application currently uses fictional/demo data and is intended as a prototype rather than a production attendance system.

## Screenshots

_Screenshots coming soon._

## Future Improvements

- Real authentication and secure password storage
- Backend database
- Real SMS / WhatsApp / email notifications
- Production-grade role-based access control
- Cloud deployment
- Institutional integration