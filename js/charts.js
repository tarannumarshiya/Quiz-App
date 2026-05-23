let radarChartInstance = null;
let lineChartInstance = null;
let doughnutChartInstance = null;

// Clean up existing charts before recreating to avoid memory leaks or rendering bugs
export function destroyCharts() {
  if (radarChartInstance) {
    radarChartInstance.destroy();
    radarChartInstance = null;
  }
  if (lineChartInstance) {
    lineChartInstance.destroy();
    lineChartInstance = null;
  }
  if (doughnutChartInstance) {
    doughnutChartInstance.destroy();
    doughnutChartInstance = null;
  }
}

// Generate all three analytics charts
export function renderAnalyticsCharts(attempts) {
  destroyCharts();

  if (!attempts || attempts.length === 0) {
    renderEmptyState();
    return;
  }

  // -------------------------------------------------------------
  // 1. Process data for Accuracy Doughnut Chart
  // -------------------------------------------------------------
  let totalCorrect = 0;
  let totalIncorrect = 0;

  attempts.forEach(attempt => {
    const correct = parseInt(attempt.score) || 0;
    const total = parseInt(attempt.totalQuestions) || 5;
    totalCorrect += correct;
    totalIncorrect += (total - correct);
  });

  const totalQuestionsAnswered = totalCorrect + totalIncorrect;
  const accuracyPercentage = totalQuestionsAnswered > 0 ? Math.round((totalCorrect / totalQuestionsAnswered) * 100) : 0;

  // -------------------------------------------------------------
  // 2. Process data for Genre Radar Chart
  // -------------------------------------------------------------
  const genreTotals = {};
  const genreCounts = {};
  
  const activeGenres = ['Coding', 'General', 'Science', 'History', 'Pop Culture', 'Other'];
  
  activeGenres.forEach(g => {
    genreTotals[g] = 0;
    genreCounts[g] = 0;
  });

  attempts.forEach(attempt => {
    let genre = 'Other';
    const rawGenre = (attempt.genre || '').trim().toLowerCase();
    
    if (rawGenre.includes('cod')) genre = 'Coding';
    else if (rawGenre.includes('gen')) genre = 'General';
    else if (rawGenre.includes('sci')) genre = 'Science';
    else if (rawGenre.includes('his')) genre = 'History';
    else if (rawGenre.includes('pop') || rawGenre.includes('cul')) genre = 'Pop Culture';

    genreTotals[genre] = (genreTotals[genre] || 0) + attempt.percentage;
    genreCounts[genre] = (genreCounts[genre] || 0) + 1;
  });

  const radarLabels = [];
  const radarData = [];

  activeGenres.forEach(genre => {
    radarLabels.push(genre);
    const avg = genreCounts[genre] > 0 ? Math.round(genreTotals[genre] / genreCounts[genre]) : 0;
    radarData.push(avg);
  });

  // -------------------------------------------------------------
  // 3. Process data for Performance Line Chart (Last 8 attempts)
  // -------------------------------------------------------------
  const recentAttempts = attempts.slice(-8);
  const lineLabels = recentAttempts.map(attempt => {
    const title = attempt.quizTitle || 'Quiz';
    return title.length > 10 ? `${title.slice(0, 10)}...` : title;
  });
  const lineData = recentAttempts.map(attempt => attempt.percentage);

  // =============================================================
  // RENDER DOUGHNUT CHART (Accuracy Ratio)
  // =============================================================
  const ctxDoughnut = document.getElementById('accuracyDoughnutChart');
  if (ctxDoughnut) {
    doughnutChartInstance = new window.Chart(ctxDoughnut, {
      type: 'doughnut',
      data: {
        labels: ['Correct Answers', 'Incorrect Answers'],
        datasets: [{
          data: [totalCorrect, totalIncorrect],
          backgroundColor: [
            'rgba(57, 255, 20, 0.25)', // Neon Green
            'rgba(255, 0, 127, 0.25)'  // Neon Pink
          ],
          borderColor: [
            '#39ff14', 
            '#ff007f'
          ],
          borderWidth: 2,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: 'rgba(255, 255, 255, 0.7)',
              font: {
                family: 'Plus Jakarta Sans',
                size: 11,
                weight: '500'
              },
              padding: 15
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const value = context.raw;
                const percentage = totalQuestionsAnswered > 0 ? Math.round((value / totalQuestionsAnswered) * 100) : 0;
                return ` ${context.label}: ${value} (${percentage}%)`;
              }
            }
          }
        }
      },
      plugins: [{
        id: 'centerText',
        beforeDraw: function(chart) {
          const width = chart.width;
          const height = chart.height;
          const ctx = chart.ctx;
          
          ctx.restore();
          // Draw percentage number
          ctx.font = '800 24px Space Grotesk';
          ctx.fillStyle = '#39ff14';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          const text = `${accuracyPercentage}%`;
          const textX = width / 2;
          // Shift text slightly upward to accommodate legend on bottom
          const textY = (height - 30) / 2;
          
          ctx.fillText(text, textX, textY);
          
          // Draw label
          ctx.font = '600 10px Plus Jakarta Sans';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.fillText('ACCURACY', textX, textY + 20);
          ctx.save();
        }
      }]
    });
  }

  // =============================================================
  // RENDER RADAR CHART (Genre Profiles)
  // =============================================================
  const ctxRadar = document.getElementById('genreRadarChart');
  if (ctxRadar) {
    radarChartInstance = new window.Chart(ctxRadar, {
      type: 'radar',
      data: {
        labels: radarLabels,
        datasets: [{
          label: 'Mastery Score (%)',
          data: radarData,
          backgroundColor: 'rgba(0, 242, 254, 0.15)',
          borderColor: '#00f2fe',
          borderWidth: 2,
          pointBackgroundColor: '#00f2fe',
          pointBorderColor: '#06080d',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: '#00f2fe',
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return ` ${context.label}: ${context.raw}%`;
              }
            }
          }
        },
        scales: {
          r: {
            angleLines: {
              color: 'rgba(255, 255, 255, 0.08)'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.08)'
            },
            pointLabels: {
              color: 'rgba(255, 255, 255, 0.7)',
              font: {
                size: 11,
                family: 'Plus Jakarta Sans'
              }
            },
            ticks: {
              display: false,
              stepSize: 20
            },
            suggestedMin: 0,
            suggestedMax: 100
          }
        }
      }
    });
  }

  // =============================================================
  // RENDER LINE CHART (Score Progression History)
  // =============================================================
  const ctxLine = document.getElementById('historyLineChart');
  if (ctxLine) {
    const gradient = ctxLine.getContext('2d').createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(255, 0, 127, 0.25)');
    gradient.addColorStop(1, 'rgba(255, 0, 127, 0.0)');

    lineChartInstance = new window.Chart(ctxLine, {
      type: 'line',
      data: {
        labels: lineLabels,
        datasets: [{
          label: 'Score (%)',
          data: lineData,
          fill: true,
          backgroundColor: gradient,
          borderColor: '#ff007f',
          borderWidth: 3,
          tension: 0.4,
          pointBackgroundColor: '#ff007f',
          pointBorderColor: '#06080d',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: '#ff007f',
          pointRadius: 5,
          pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return ` Score: ${context.raw}%`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.04)'
            },
            ticks: {
              color: 'rgba(255, 255, 255, 0.5)',
              font: {
                family: 'Plus Jakarta Sans',
                size: 10
              }
            }
          },
          y: {
            grid: {
              color: 'rgba(255, 255, 255, 0.04)'
            },
            ticks: {
              color: 'rgba(255, 255, 255, 0.5)',
              font: {
                family: 'Plus Jakarta Sans'
              },
              stepSize: 20
            },
            min: 0,
            max: 100
          }
        }
      }
    });
  }
}

// Render simple visual placeholders inside canvas containers if no records exist
function renderEmptyState() {
  const containers = ['accuracyDoughnutChart', 'genreRadarChart', 'historyLineChart'];
  containers.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const ctx = el.getContext('2d');
      ctx.clearRect(0, 0, el.width, el.height);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.font = '13px Plus Jakarta Sans';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Take your first quiz to generate statistics!', el.width / 2, el.height / 2);
    }
  });
}