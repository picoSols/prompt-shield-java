package au.picosols.promptshield.persistence;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ScanAuditRepository extends JpaRepository<ScanAuditEntity, String> {

    @Query(value = "SELECT * FROM scan_audit ORDER BY created_at DESC LIMIT :limit",
           nativeQuery = true)
    List<ScanAuditEntity> findRecent(@Param("limit") int limit);
}
