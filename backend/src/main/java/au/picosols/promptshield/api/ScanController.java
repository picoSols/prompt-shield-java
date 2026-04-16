package au.picosols.promptshield.api;

import au.picosols.promptshield.persistence.ScanAuditEntity;
import au.picosols.promptshield.persistence.ScanAuditRepository;
import au.picosols.promptshield.scan.ShieldService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping
public class ScanController {

    private final ShieldService shieldService;
    private final ScanAuditRepository auditRepository;

    public ScanController(ShieldService shieldService, ScanAuditRepository auditRepository) {
        this.shieldService = shieldService;
        this.auditRepository = auditRepository;
    }

    @PostMapping("/scan")
    public ResponseEntity<ScanResponse> scan(@Valid @RequestBody ScanRequest request) {
        var result = shieldService.scan(request.input(), request.scanner());
        return ResponseEntity.ok(ScanResponse.from(result));
    }

    @GetMapping("/audit")
    public List<ScanAuditEntity> recent(
            @RequestParam(defaultValue = "50") int limit
    ) {
        int capped = Math.min(Math.max(limit, 1), 200);
        return auditRepository.findRecent(capped);
    }
}
