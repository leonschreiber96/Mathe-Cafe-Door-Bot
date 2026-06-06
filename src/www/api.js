fetch("http://localhost:3000/api/dashboard")
   .then((res) => res.json())
   .then((data) => renderKpis(data.kpis));
